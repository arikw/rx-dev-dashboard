import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * media-cache files (public/_cache/<connector>/<hash>.<ext>) are downloaded
 * by load-projects.ts DURING page rendering — after Astro has already copied
 * public/ to dist/. Mirror them into dist/_cache/ at build:done so the
 * deployed site can actually serve them.
 */
function copyMediaCache() {
  return {
    name: 'copy-media-cache',
    hooks: {
      'astro:build:done': ({ dir }) => {
        const from = resolve(here, 'public/_cache');
        const to = fileURLToPath(new URL('_cache', dir));
        if (existsSync(from)) cpSync(from, to, { recursive: true });
      },
    },
  };
}

// Deployment settings live in projects.config.ts so cloners only edit one file.
// projects.config.local.ts (gitignored) shallow-overrides for local dev.
const here = dirname(fileURLToPath(import.meta.url));
const localPath = resolve(here, 'projects.config.local.ts');
const baseCfg = (await import('./projects.config.ts')).default;
const localCfg = existsSync(localPath)
  ? (await import('./projects.config.local.ts')).default
  : undefined;
const deployment = { ...baseCfg.deployment, ...localCfg?.deployment };

export default defineConfig({
  site: deployment.site,
  base: deployment.base,
  trailingSlash: deployment.trailingSlash ?? 'always',
  build: {
    format: deployment.format ?? 'directory',
  },
  integrations: [mdx(), sitemap(), copyMediaCache()],
  markdown: {
    syntaxHighlight: 'shiki',
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark-dimmed',
      },
      wrap: false,
    },
  },
});
