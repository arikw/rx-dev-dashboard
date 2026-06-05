import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Review } from '../../types/project';

const run = promisify(execFile);

const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0';

// What we whitelist from the chrome-stats SSR data. We deliberately DROP
// developer email and authorId (PII) per the project's anonymity rules.
export type ChromeStatsApp = {
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
  /** Square 128×128 extension icon. chrome-stats stores it as `logo:"…"` on
   *  the per-extension record — present even on `isDeleted` listings (the
   *  CWS image CDN keeps the icon alive after the listing is removed).
   *  Distinct from smallBanner/marqueeBanner, which are the promo tiles. */
  logo?: string;
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
  /** Visible review snippets (no author info captured). */
  reviews?: Review[];
  /** chrome-stats's `extensionDeleted` flag — true once Google removes the
   * listing from CWS. The cached user count then becomes a stale snapshot
   * of the last observed value; we drop it from the canonical stats. */
  isDeleted?: boolean;
  /** YouTube videos chrome-stats lists for the extension. Stored as the
   *  watch/embed URLs the SSR hydration data exposes. */
  videos?: string[];
};

// chrome-stats sits behind Cloudflare. Plain curl's TLS handshake is now
// fingerprinted and 403'd regardless of UA — Cloudflare gates by JA3/JA4,
// not Mozilla string. Set CURL_IMPERSONATE_BIN to a curl-impersonate
// browser-impersonating binary (e.g. /path/to/curl_chrome136) and the
// scraper uses it instead; otherwise falls back to the vanilla curl call
// the previously-cached scrapes still came through. Keeps cloners with
// no special setup working in cache+commit mode, while the maintainer's
// local seed can refresh the cache with a single env-var.
const IMPERSONATE_BIN = process.env.CURL_IMPERSONATE_BIN;
async function fetchHtml(url: string): Promise<string | null> {
  try {
    const args = IMPERSONATE_BIN
      ? ['-sL', '--max-time', '25', url]
      : [
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
        ];
    const { stdout } = await run(IMPERSONATE_BIN ?? 'curl', args, {
      maxBuffer: 16 * 1024 * 1024,
    });
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

/** Pull the histogram + the review bodies from the /reviews subpage's SSR data. */
export async function scrapeReviewsPage(
  extId: string,
): Promise<{ histogram: number[] | null; reviews: Review[] }> {
  const url = `https://chrome-stats.com/d/${encodeURIComponent(extId)}/reviews`;
  const doc = await fetchHtml(url);
  if (!doc) return { histogram: null, reviews: [] };
  const script = findHydrationScript(doc);
  if (!script) return { histogram: null, reviews: [] };

  const hm = script.match(
    /\{\s*"1"\s*:\s*(\d+)\s*,\s*"2"\s*:\s*(\d+)\s*,\s*"3"\s*:\s*(\d+)\s*,\s*"4"\s*:\s*(\d+)\s*,\s*"5"\s*:\s*(\d+)\s*\}/,
  );
  const histogram = hm ? [Number(hm[1]), Number(hm[2]), Number(hm[3]), Number(hm[4]), Number(hm[5])] : null;

  // Each review record looks like:
  //   {…,authorName:"T*****",rating:5,authorPicture:"…",id:"<extId>",authorId:"…",
  //    body:"…",timestamp:"YYYY-MM-DD",isBadReviewer:false}
  // Capture only rating + body + timestamp — author fields are PII.
  const re = new RegExp(
    `rating:(\\d).*?body:(${JS_STR}).*?timestamp:"([0-9-]+)"`,
    'g',
  );
  const reviews: Review[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(script))) {
    const body = decodeJsString(m[2]);
    if (!body) continue;
    reviews.push({ rating: Number(m[1]), body, ts: m[3], source: 'chrome-stats' });
  }
  return { histogram, reviews };
}

export async function scrapeOne(extId: string): Promise<ChromeStatsApp | null> {
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
    logo: pickString(record, 'logo'),
    size: pickNumber(record, 'size'),
    helpUrl: pickString(record, 'helpUrl'),
    creationDate: pickString(record, 'creationDate'),
    lastUpdate: pickString(record, 'lastUpdate'),
    isFeatured: pickBool(record, 'isFeatured'),
    riskImpact: pickNumber(record, 'riskImpact'),
    riskLikelihood: pickNumber(record, 'riskLikelihood'),
    permissions: pickPermissions(record),
    // extensionDeleted lives outside the per-extension record (page-level
    // SSR state), so search the whole hydration script. The script we fetched
    // describes only this extension, so the flag is unambiguous here.
    isDeleted: /\bextensionDeleted:true\b/.test(script),
    // Videos are emitted as `{thumbnail:"…",video:"https://…youtube.com/…"}`
    // entries, and the videos array often sits outside the per-extension
    // record window. The fetched script describes only this extension, so
    // the YouTube URLs found anywhere in it belong to this listing.
    videos: extractVideos(script),
  };
  return app;
}

/** Extract YouTube video URLs from a chrome-stats hydration script. */
function extractVideos(script: string): string[] | undefined {
  const out = new Set<string>();
  const re = /\bvideo:\s*(["'])((?:https?:\/\/)?(?:www\.)?youtube(?:-nocookie)?\.com\/[^"']+)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(script))) out.add(m[2]);
  return out.size ? [...out] : undefined;
}
