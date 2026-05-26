import type { APIRoute } from 'astro';
import { loadProjects, getSnapshot } from '../lib/load-projects';

// Exposes the snapshot + merged project list as JSON so you can inspect what
// each connector returned (and when) without spelunking through the build.
// curl <site>/data.json
export const GET: APIRoute = async () => {
  const projects = await loadProjects();
  const snapshot = getSnapshot();
  const body = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      connectors: snapshot?.connectors ?? {},
      projects,
    },
    null,
    2,
  );
  return new Response(body, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
