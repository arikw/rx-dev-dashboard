import type { APIRoute } from 'astro';
import config from '../lib/load-config';

// robots.txt is only honoured at the site root (crawlers fetch
// `<host>/robots.txt`, never `<host>/<base>/robots.txt`). So we only emit a
// useful file when the site is mounted at root. For sub-path deployments,
// emit a comment-only marker that explains the omission.
export const GET: APIRoute = ({ site }) => {
  if (config.deployment.base !== '/') {
    const body = '# Deployed under a sub-path; the host\'s root robots.txt governs crawling.\n';
    return new Response(body, { headers: { 'Content-Type': 'text/plain' } });
  }
  const lines = ['User-agent: *', 'Allow: /'];
  if (site) lines.push('', `Sitemap: ${site.toString().replace(/\/$/, '')}/sitemap-index.xml`);
  return new Response(lines.join('\n') + '\n', {
    headers: { 'Content-Type': 'text/plain' },
  });
};
