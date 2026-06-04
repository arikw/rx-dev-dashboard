import type { APIRoute } from 'astro';
import { loadProjects, getSnapshot, getHidden } from '../lib/load-projects';

// Surfaces the dashboard's health state in a single endpoint a developer can
// curl. Designed to answer: "is anything broken here, and do I need to act?"
//
// Status is ok=false when any connector reported a failed attempt OR when
// any project was dropped by `isRenderable` (a stub that has no friendly
// title because its enrichment source — chromestats / apkpure / appbrain —
// couldn't be reached on the build runner). Both conditions point at the
// same fix: run `npm run build` locally so the connector caches accumulate
// the missing entries, then commit `generated/.cache/` + `public/_cache/`.
//
//   curl <site>/status.json
export const GET: APIRoute = async () => {
  // Ensure the loader has run; the snapshot and hidden list are
  // populated as a side-effect of `loadProjects()`.
  await loadProjects();
  const snapshot = getSnapshot();
  const hidden = getHidden();

  const connectors: Record<string, { ok: boolean; lastScrapedAt: string; lastAttempt: { at: string; ok: boolean; error?: string } }> = {};
  for (const [k, v] of Object.entries(snapshot?.connectors ?? {})) {
    if (!v) continue;
    connectors[k] = {
      ok: v.lastAttempt.ok,
      lastScrapedAt: v.lastScrapedAt,
      lastAttempt: v.lastAttempt,
    };
  }

  const failedConnectors = Object.entries(connectors).filter(([, c]) => !c.ok).map(([k]) => k);
  const ok = failedConnectors.length === 0 && hidden.length === 0;

  const hint = ok
    ? null
    : 'Some essentials are missing. Build locally (`npm run build`) to populate the connector caches that the CI runner can\'t reach — usually Cloudflare-gated sources like chrome-stats.com, AppBrain, and APKPure. Then `git add -f generated/.cache/ public/_cache/`, commit, and push. CI will pick up the seeded caches on the next deploy.';

  const body = JSON.stringify(
    {
      ok,
      checkedAt: new Date().toISOString(),
      failedConnectors,
      hiddenProjects: hidden,
      connectors,
      hint,
    },
    null,
    2,
  );

  return new Response(body, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
