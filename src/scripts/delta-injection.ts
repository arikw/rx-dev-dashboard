export type Direction = 'up' | 'down';
export type DeltaInfo = { value: number; direction: Direction; label: string };

export function formatNumber(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k.toFixed(k < 10 ? 1 : 0).replace(/\.0$/, '')}k`;
  }
  return String(n);
}

export function injectDelta(slot: HTMLElement, delta: DeltaInfo, relativeTime: string): void {
  if (delta.value === 0) return;
  const arrow = delta.direction === 'up' ? '▲' : '▼';
  const sign = delta.direction === 'up' ? '+' : '−';
  slot.classList.toggle('is-negative', delta.direction === 'down');
  slot.innerHTML = `<span class="stat-delta-arrow" aria-hidden="true">${arrow}</span>${sign}${formatNumber(delta.value)}`;
  const tooltipParts = [`${sign}${formatNumber(delta.value)} ${delta.label}`];
  if (relativeTime) tooltipParts.push(relativeTime);
  slot.dataset.tooltip = tooltipParts.join(' ');
  slot.removeAttribute('hidden');
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function populateVisitSummary(opts: {
  newProjectCount: number;
  removedProjectCount: number;
  relativeTime: string;
  newProjectNames?: string[];
  removedProjectNames?: string[];
}): void {
  const el = document.querySelector<HTMLElement>('.visit-summary');
  if (!el) return;
  const parts: string[] = [];
  if (opts.newProjectCount > 0) {
    const label = opts.newProjectCount === 1 ? 'new project' : 'new projects';
    const tip = opts.newProjectNames?.length ? ` data-tooltip="${escapeAttr(opts.newProjectNames.join(', '))}"` : '';
    parts.push(`<span class="visit-summary-new"${tip}>${opts.newProjectCount} ${label}</span>`);
  }
  if (opts.removedProjectCount > 0) {
    const tip = opts.removedProjectNames?.length ? ` data-tooltip="${escapeAttr(opts.removedProjectNames.join(', '))}"` : '';
    parts.push(`<span class="visit-summary-removed"${tip}>${opts.removedProjectCount} removed</span>`);
  }
  if (!parts.length) return;
  const time = opts.relativeTime ? ` ${opts.relativeTime}` : '';
  el.innerHTML = parts.join('<span class="visit-summary-sep">·</span>') + time;
  el.removeAttribute('hidden');
}

export function formatRelativeTime(iso: string): string {
  const past = new Date(iso).getTime();
  if (!Number.isFinite(past)) return '';
  const diffMs = Date.now() - past;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

export function readHashParam(name: string): string | null {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  return new URLSearchParams(raw).get(name);
}
