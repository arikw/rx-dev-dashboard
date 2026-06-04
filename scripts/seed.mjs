#!/usr/bin/env node
// Refresh connector caches from a local build (residential IP can reach
// Cloudflare-gated sources the GitHub Actions runner can't), commit the
// caches back, push, and dispatch the deploy. Falls back to printed
// instructions when `gh` is missing or unauthenticated.
//
//   npm run seed

import { spawnSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ANSI = process.stdout.isTTY ? {
  dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  reset: '\x1b[0m',
} : {
  dim: '', bold: '', green: '', red: '', yellow: '', reset: '',
};
const { dim, bold, green, red, yellow, reset } = ANSI;

function step(label) {
  console.log(`\n${bold}▸ ${label}${reset}`);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    console.error(`${red}✗ ${cmd} ${args.join(' ')} failed (exit ${r.status})${reset}`);
    process.exit(r.status ?? 1);
  }
}

function runQuiet(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function hasGh() {
  const r = runQuiet('gh', ['--version']);
  return r.status === 0;
}

function ghAuthed() {
  const r = runQuiet('gh', ['auth', 'status']);
  return r.status === 0;
}

function parseRepo() {
  const r = runQuiet('git', ['remote', 'get-url', 'origin']);
  if (r.status !== 0) return null;
  const m = r.stdout.trim().match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/i);
  return m ? { owner: m[1], name: m[2], fullName: `${m[1]}/${m[2]}` } : null;
}

const cwd = process.cwd();
if (!existsSync(resolve(cwd, 'package.json'))) {
  console.error(`${red}✗ run this from the project root (no package.json found in ${cwd})${reset}`);
  process.exit(2);
}
const repo = parseRepo();
if (!repo) {
  console.error(`${red}✗ could not parse a github owner/repo from origin${reset}`);
  process.exit(2);
}

step(`Build (populating caches from this machine's IP)`);
run('npm', ['run', 'build']);

step(`Stage refreshed caches`);
run('git', ['add', '-f', 'generated/', 'public/_cache/']);

const diffCheck = runQuiet('git', ['diff', '--cached', '--quiet']);
if (diffCheck.status === 0) {
  console.log(`${dim}  nothing changed — caches are already up to date${reset}`);
} else {
  step(`Commit`);
  run('git', ['commit', '-m', 'Refresh connector caches from local build']);
  step(`Push to origin`);
  run('git', ['push', 'origin', 'HEAD']);
}

step(`Dispatch deploy`);
if (hasGh() && ghAuthed()) {
  run('gh', ['workflow', 'run', 'deploy.yml', '--repo', repo.fullName, '--ref', 'master']);
  console.log(`${green}✓${reset} deploy.yml dispatched on ${bold}${repo.fullName}${reset}`);
  console.log(`${dim}  watch with: gh run list --repo ${repo.fullName} --workflow deploy.yml${reset}`);
} else {
  console.log(`${yellow}!${reset} gh CLI not ${hasGh() ? 'authenticated' : 'installed'} — dispatch the deploy manually:`);
  console.log();
  console.log(`  ${bold}Option A — GitHub web UI:${reset}`);
  console.log(`    https://github.com/${repo.fullName}/actions/workflows/deploy.yml`);
  console.log(`    Click ${bold}Run workflow${reset} → ${bold}Run workflow${reset}`);
  console.log();
  console.log(`  ${bold}Option B — install / auth gh CLI, then rerun:${reset}`);
  console.log(`    https://cli.github.com/`);
  console.log(`    gh auth login`);
  console.log(`    npm run seed`);
}
console.log();
console.log(`${dim}When the deploy lands, run ${bold}npm run status${reset}${dim} to verify.${reset}`);
