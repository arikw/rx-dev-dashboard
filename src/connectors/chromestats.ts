import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Connector } from './types';
import type { ConnectorResult } from '../types/project';
import { loadFixture } from '../lib/fixtures';
import { readJsonCache, writeJsonCache } from '../lib/json-cache';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const run = promisify(execFile);

const CACHE_PATH = 'generated/chrome-stats.json';
const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0';

// What we whitelist from the chrome-stats SSR data. We deliberately DROP
// developer email and authorId (PII) per the project's anonymity rules.
type ChromeStatsApp = {
  id: string;
  name?: string;
  description?: string;
  /** chrome-stats page URL. */
  url: string;
  version?: string;
  userCount?: number;
  rating?: { value: number; count: number };
  /** Per-star counts [1★..5★] when chrome-stats exposes them. */
  ratingHistogram?: number[];
  category?: string;
  itemCategory?: string;
  supportedLanguages?: string[];
  smallBanner?: string;
  marqueeBanner?: string;
  /** Approximate install size in bytes. */
  size?: number;
  helpUrl?: string;
  /** ISO date strings. */
  creationDate?: string;
  lastUpdate?: string;
  isFeatured?: boolean;
  /** chrome-stats' own risk scoring. */
  riskImpact?: number;
  riskLikelihood?: number;
  permissions?: Array<{ key: string; risk: number }>;
  ranking?: unknown;
};

type ChromeStatsCache = { version: 1; _generated: string; apps: Record<string, ChromeStatsApp> };

const NOTE =
  'Auto-generated chrome-stats.com cache. Fetched once per extension id; delete the file to refresh. PII (email, authorId) is intentionally omitted.';

const emptyCache = (): ChromeStatsCache => ({ version: 1, _generated: NOTE, apps: {} });

// chrome-stats sits behind Cloudflare. curl with realistic headers works;
// Node's fetch (undici) is fingerprinted and 403'd. Same trick as appbrain.
async function fetchHtml(url: string): Promise<string | null> {
  try {
    const { stdout } = await run(
      'curl',
      [
        '-sL',
        '--max-time',
        '25',
        '-A',
        UA,
        '-H',
        'Accept-Language: en-US,en;q=0.9',
        '-H',
        'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        url,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    return stdout || null;
  } catch {
    return null;
  }
}

/** Pull the largest inline <script> (the SSR/hydration blob) from the page. */
function findHydrationScript(doc: string): string | null {
  const blocks: string[] = [];
  const re = /<script(?:\s[^>]*)?>([\s\S]+?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc))) blocks.push(m[1]);
  if (!blocks.length) return null;
  blocks.sort((a, b) => b.length - a.length);
  return blocks[0];
}

/** JS string-literal capture: matches "…" or '…' with simple escapes. */
const JS_STR = `(?:"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')`;

function decodeJsString(raw: string): string {
  const q = raw[0];
  const body = raw.slice(1, -1);
  return body
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\(['"\\])/g, '$1')
    .replace(/\\\//g, '/')
    .replace(q === '"' ? /\\"/g : /\\'/g, q);
}

function findRecord(script: string, extId: string): string | null {
  // Anchor on the extension's own id literal.
  const anchor = script.indexOf(`id:"${extId}"`);
  if (anchor < 0) return null;
  // Slice a generous window forward; bail at the next 32-char extension id, or
  // at the next "name:" record marker — whichever comes first.
  const tail = script.slice(anchor, anchor + 6000);
  const next = tail.slice(`id:"${extId}"`.length).search(/\bid:"[a-p]{32}"|\},\{name:"/);
  const end = next > 0 ? `id:"${extId}"`.length + next : tail.length;
  // Walk back ~400 chars from the anchor to catch fields written before the id.
  const back = Math.max(0, anchor - 400);
  return script.slice(back, anchor + end);
}

function pickString(record: string, key: string): string | undefined {
  const m = record.match(new RegExp(`\\b${key}:(${JS_STR})`));
  return m ? decodeJsString(m[1]) : undefined;
}
function pickNumber(record: string, key: string): number | undefined {
  const m = record.match(new RegExp(`\\b${key}:(-?\\d+(?:\\.\\d+)?)`));
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}
function pickBool(record: string, key: string): boolean | undefined {
  const m = record.match(new RegExp(`\\b${key}:(true|false)`));
  return m ? m[1] === 'true' : undefined;
}
function pickStringArray(record: string, key: string): string[] | undefined {
  const m = record.match(new RegExp(`\\b${key}:\\[([^\\]]*)\\]`));
  if (!m) return undefined;
  const items = m[1].match(new RegExp(JS_STR, 'g')) ?? [];
  return items.map(decodeJsString);
}
function pickHistogram(record: string): number[] | undefined {
  // Try a handful of shapes chrome-stats might use.
  for (const pat of [
    /\b(?:ratingHistogram|ratingsBreakdown|starsBreakdown|histogram)\s*:\s*\[([\s\S]*?)\]/,
    /\bratings:\s*\[((?:\s*-?\d+\s*,?){4,5})\]/,
  ]) {
    const m = record.match(pat);
    if (m) {
      const nums = m[1].match(/-?\d+(?:\.\d+)?/g) ?? [];
      if (nums.length >= 5) return nums.slice(0, 5).map(Number);
    }
  }
  // Spread form: ratings1:n, ratings2:n, ...
  const arr: number[] = [];
  let any = false;
  for (let i = 1; i <= 5; i++) {
    const m = record.match(new RegExp(`\\bratings${i}:(\\d+)`));
    if (m) { any = true; arr.push(Number(m[1])); } else { arr.push(0); }
  }
  return any ? arr : undefined;
}
function pickPermissions(record: string): Array<{ key: string; risk: number }> | undefined {
  const m = record.match(/\bpermissions:\s*\[([\s\S]*?)\]/);
  if (!m) return undefined;
  const out: Array<{ key: string; risk: number }> = [];
  const itemRe = /\{key:("[^"]+"|'[^']+'),risk:(\d+)\}/g;
  let im: RegExpExecArray | null;
  while ((im = itemRe.exec(m[1]))) {
    out.push({ key: decodeJsString(im[1]), risk: Number(im[2]) });
  }
  return out.length ? out : undefined;
}

/** Pull the rating histogram from the /reviews subpage's SSR data. */
async function scrapeHistogram(extId: string): Promise<number[] | null> {
  const url = `https://chrome-stats.com/d/${encodeURIComponent(extId)}/reviews`;
  const doc = await fetchHtml(url);
  if (!doc) return null;
  const script = findHydrationScript(doc);
  if (!script) return null;
  const m = script.match(
    /\{\s*"1"\s*:\s*(\d+)\s*,\s*"2"\s*:\s*(\d+)\s*,\s*"3"\s*:\s*(\d+)\s*,\s*"4"\s*:\s*(\d+)\s*,\s*"5"\s*:\s*(\d+)\s*\}/,
  );
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])] : null;
}

async function scrapeOne(extId: string): Promise<ChromeStatsApp | null> {
  const url = `https://chrome-stats.com/d/${encodeURIComponent(extId)}`;
  const doc = await fetchHtml(url);
  if (!doc) return null;
  const script = findHydrationScript(doc);
  if (!script) return null;
  const record = findRecord(script, extId);
  if (!record) return null;

  const ratingValue = pickNumber(record, 'ratingValue');
  const ratingCount = pickNumber(record, 'ratingCount');

  const app: ChromeStatsApp = {
    id: extId,
    url,
    name: pickString(record, 'name'),
    description: pickString(record, 'description'),
    version: pickString(record, 'version') ?? pickString(record, 'versionCode'),
    userCount: pickNumber(record, 'userCount'),
    rating: ratingValue != null && ratingCount != null ? { value: ratingValue, count: ratingCount } : undefined,
    ratingHistogram: pickHistogram(record),
    category: pickString(record, 'category'),
    itemCategory: pickString(record, 'itemCategory'),
    supportedLanguages: pickStringArray(record, 'supportedLanguages'),
    smallBanner: pickString(record, 'smallBanner'),
    marqueeBanner: pickString(record, 'marqueeBanner'),
    size: pickNumber(record, 'size'),
    helpUrl: pickString(record, 'helpUrl'),
    creationDate: pickString(record, 'creationDate'),
    lastUpdate: pickString(record, 'lastUpdate'),
    isFeatured: pickBool(record, 'isFeatured'),
    riskImpact: pickNumber(record, 'riskImpact'),
    riskLikelihood: pickNumber(record, 'riskLikelihood'),
    permissions: pickPermissions(record),
  };
  return app;
}

export const fetchChromestatsProjects: Connector = async (config, options) => {
  // Shared list with the chrome connector — like AppBrain/APKPure share
  // sources.gplay.packages.
  const extensionIds = config.sources.chrome.extensionIds;
  if (!extensionIds.length) return [];

  if (options?.fixtureMode) return loadFixture('chromestats');

  const cache = readJsonCache<ChromeStatsCache>(CACHE_PATH, emptyCache());
  if (cache.version !== 1 || !cache.apps) Object.assign(cache, emptyCache());
  cache._generated = NOTE;

  for (const id of extensionIds) {
    if (!cache.apps[id]) {
      const app = await scrapeOne(id);
      if (app) cache.apps[id] = app;
      await sleep(300);
    }
    // Backfill the rating histogram from the /reviews subpage if missing.
    const entry = cache.apps[id];
    if (entry && !entry.ratingHistogram) {
      const hist = await scrapeHistogram(id);
      if (hist) entry.ratingHistogram = hist;
      await sleep(300);
    }
  }
  writeJsonCache(CACHE_PATH, cache);

  return extensionIds
    .map((id) => cache.apps[id])
    .filter((a): a is ChromeStatsApp => !!a)
    .map<ConnectorResult>((a) => ({
      // The origin is the Chrome Web Store extension — same `platform: 'chrome'`
      // as the chrome.ts connector, so when an extension exists on BOTH the
      // builder reconciles them per origin id. We deliberately omit `url`: for
      // taken-down extensions the CWS listing is dead, so the builder falls
      // through to the (alive) chrome-stats mirror url below. When chrome.ts
      // also contributes, it supplies the real CWS url and that wins.
      origin: { platform: 'chrome', id: a.id },
      mirror: {
        platform: 'chrome-stats',
        id: a.id,
        url: a.url,
        asOf: a.lastUpdate,
        title: a.name,
        description: a.description,
        firstReleased: a.creationDate ? new Date(a.creationDate).getUTCFullYear() : undefined,
        tags: [
          'chrome-extension',
          // chrome-stats categories look like "productivity/workflow" or
          // "14_fun"; strip the numeric prefix and take the leaf word.
          ...(a.category ? [a.category.replace(/^\d+_/, '').split('/').pop()!] : []),
        ],
        kind: 'extension',
        image: a.marqueeBanner ?? a.smallBanner,
        stats: {
          ...(a.userCount != null ? { users: a.userCount } : {}),
          ...(a.rating
            ? {
                rating: {
                  average: a.rating.value,
                  count: a.rating.count,
                  ...(a.ratingHistogram ? { histogram: a.ratingHistogram } : {}),
                },
              }
            : {}),
        },
      },
    }));
};
