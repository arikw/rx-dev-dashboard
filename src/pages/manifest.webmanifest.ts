import type { APIRoute } from 'astro';
import config from '../lib/load-config';
import { loadProjects, getProfiles } from '../lib/load-projects';
import { resolveManifestIcons, resolveManifestBackground } from '../lib/resolve-favicon';

// PWA web app manifest. Values come from projects.config.ts so a cloner
// gets a working installable manifest by editing the same single source
// of truth as the rest of the dashboard.
//
// Served from `<base>manifest.webmanifest` and referenced by BaseHead via
// `<link rel="manifest" href="…">`. Mounted at the deployment base so it
// resolves correctly on sub-path deployments (e.g. `/projects/`).
export const GET: APIRoute = async () => {
  // The loader is memoised — `getProfiles()` works because BaseHead already
  // triggered it on the index page, but this endpoint can also be hit
  // standalone in dev, so call it again to be safe.
  await loadProjects();
  const profiles = getProfiles();
  const icons = await resolveManifestIcons(profiles);
  // Default the splash-screen background to a colour sampled from the
  // favicon's corners — keeps the install splash visually contiguous
  // with the home-screen icon. Falls back to white when no avatar is
  // reachable. Config can always override.
  const sampledBackground = await resolveManifestBackground(profiles);

  const base = config.deployment.base.endsWith('/')
    ? config.deployment.base
    : `${config.deployment.base}/`;

  const manifest = {
    name: config.meta.siteTitle,
    short_name: config.meta.shortName ?? config.meta.siteTitle,
    description: config.meta.siteDescription,
    start_url: base,
    scope: base,
    display: 'standalone',
    theme_color: config.meta.themeColor ?? '#1f1f23',
    background_color: config.meta.backgroundColor ?? sampledBackground ?? '#ffffff',
    icons,
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
  });
};
