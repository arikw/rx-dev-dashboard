// Human-friendly labels for source chips / thumbnails, keyed by platform id.
// Display-only; the raw platform stays in the data + snapshot. The Play origin
// and its mirrors all render as "Android app" so a merged card shows it once.
export const SOURCE_LABEL: Record<string, string> = {
  github: 'GitHub',
  npm: 'npm',
  docker: 'Docker',
  chrome: 'Chrome',
  gnome: 'GNOME',
  'google-play': 'Android app',
  appbrain: 'Android app',
  apkpure: 'Android app',
  manual: 'Portfolio',
};

export function sourceLabel(s: string): string {
  return SOURCE_LABEL[s] ?? s;
}
