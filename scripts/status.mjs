#!/usr/bin/env node
// Hit /status.json on the deployed dashboard and pretty-print insights.
// Reads `deployment.site` + `deployment.base` from projects.config.ts (and
// projects.config.local.ts when present, since it overrides the base).
//
// Usage:
//   npm run status                                       # auto-detect URL
//   npm run status -- https://yoursite.example/projects  # explicit base URL
//
// Exits 0 when ok, 1 when something needs attention — makes it usable
// in CI / pre-deploy checks.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ANSI = process.stdout.isTTY ? {
  dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  reset: '\x1b[0m',
} : {
  dim: '', bold: '', green: '', red: '', yellow: '', reset: '',
};

function extractStringField(content, field) {
  const re = new RegExp(`\\b${field}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`);
  const m = content.match(re);
  return m ? m[1] : null;
}

function deriveBaseUrlFromConfig() {
  // Local override wins for `base`/`site` like it does at build time.
  const paths = ['projects.config.local.ts', 'projects.config.ts'];
  let site = null;
  let base = null;
  for (const p of paths) {
    const full = resolve(process.cwd(), p);
    if (!existsSync(full)) continue;
    const content = readFileSync(full, 'utf8');
    site = site ?? extractStringField(content, 'site');
    base = base ?? extractStringField(content, 'base');
    if (site && base !== null) break;
  }
  if (!site) return null;
  const trimmedSite = site.replace(/\/+$/, '');
  const cleanBase = (base ?? '').replace(/^\/+|\/+$/g, '');
  return trimmedSite + (cleanBase ? '/' + cleanBase : '');
}

const argUrl = process.argv[2]?.replace(/\/+$/, '');
const baseUrl = argUrl ?? deriveBaseUrlFromConfig();

if (!baseUrl) {
  console.error('Could not determine the dashboard URL from projects.config.ts / projects.config.local.ts.');
  console.error('Pass it explicitly:  npm run status -- https://yoursite.example/projects');
  process.exit(2);
}

const url = `${baseUrl}/status.json?bust=${Date.now()}`;

let body;
try {
  const resp = await fetch(url);
  if (!resp.ok) {
    console.error(`${ANSI.red}✗${ANSI.reset} HTTP ${resp.status} fetching ${url}`);
    process.exit(2);
  }
  body = await resp.json();
} catch (e) {
  console.error(`${ANSI.red}✗${ANSI.reset} Failed to fetch ${url}: ${e.message}`);
  process.exit(2);
}

const { dim, bold, green, red, yellow, reset } = ANSI;
const heading = body.ok
  ? `${green}✓${reset} ${bold}Status: HEALTHY${reset}`
  : `${red}✗${reset} ${bold}Status: NEEDS ATTENTION${reset}`;
console.log(`${heading} ${dim}${url.split('?')[0]}${reset}`);
console.log(`${dim}  Checked at ${body.checkedAt}${reset}`);

if (body.ok) {
  const total = Object.keys(body.connectors).length;
  console.log(`  All ${total} connectors fully covered, no hidden projects.`);
  process.exit(0);
}

console.log();

if (body.failedConnectors?.length) {
  console.log(`  ${red}↳ Failed connectors (${body.failedConnectors.length}):${reset}`);
  for (const k of body.failedConnectors) {
    const err = body.connectors[k]?.lastAttempt?.error ?? '';
    console.log(`      • ${bold}${k}${reset}${err ? `: ${err}` : ''}`);
  }
}

if (body.partialConnectors?.length) {
  console.log(`  ${yellow}↳ Partial coverage (${body.partialConnectors.length}):${reset}`);
  for (const k of body.partialConnectors) {
    const err = body.connectors[k]?.lastAttempt?.error ?? '';
    console.log(`      • ${bold}${k}${reset}${err ? `: ${err}` : ''}`);
  }
}

if (body.hiddenProjects?.length) {
  console.log(`  ${red}↳ Hidden projects (${body.hiddenProjects.length}):${reset}`);
  for (const h of body.hiddenProjects) {
    console.log(`      • ${bold}${h.id}${reset}`);
    if (h.reason) console.log(`        ${dim}${h.reason}${reset}`);
  }
}

console.log();
console.log(`  ${bold}Fix${reset}  (typically: a Cloudflare-gated source the runner can't reach):`);
console.log(`    1. ${bold}npm run build${reset}                                # populate caches from your residential IP`);
console.log(`    2. ${bold}git add -f generated/.cache/ public/_cache/${reset}  # both are gitignored locally`);
console.log(`    3. ${bold}git commit -m 'Seed caches' && git push${reset}      # push alone is path-ignored — won't auto-deploy`);
console.log(`    4. ${bold}gh workflow run deploy.yml${reset}                   # dispatch the deploy`);
console.log(`    5. Re-run ${bold}npm run status${reset} to verify.`);

process.exit(1);
