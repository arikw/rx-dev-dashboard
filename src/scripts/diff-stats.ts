import { injectDelta, populateVisitSummary, formatRelativeTime, readHashParam } from './delta-injection';

type ProjectStats = {
  stars?: number;
  downloads?: number;
  downloadsMonthly?: number;
  users?: number;
  installs?: number;
};

type ProfileSnapshot = {
  headline: { label: string; value: number };
  details: Array<{ label: string; value: number }>;
};

type DashboardState = {
  version: 1;
  generatedAt: string;
  hero: {
    starsAndLikes: number;
    downloadsAndPulls: number;
    activeUsers: number;
    totalProjects: number;
  };
  projects: Record<string, ProjectStats>;
  profiles: Record<string, ProfileSnapshot>;
};

type StoredState = {
  version: 1;
  diffBase: DashboardState;
  lastSeen: DashboardState;
};

const STORAGE_KEY = 'rx-dashboard-last-visit';

function readCurrent(): DashboardState | null {
  const el = document.querySelector<HTMLScriptElement>('#dashboard-state');
  if (!el?.textContent) return null;
  try {
    const parsed = JSON.parse(el.textContent);
    if (parsed?.version === 1 && parsed.generatedAt) return parsed as DashboardState;
  } catch {
    return null;
  }
  return null;
}

function readStored(): StoredState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && parsed.diffBase && parsed.lastSeen) return parsed as StoredState;
  } catch {
    return null;
  }
  return null;
}

function saveStored(state: StoredState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode / storage disabled */
  }
}

const HERO_MAP = [
  { key: 'starsAndLikes',    stat: 'star',     label: 'stars & likes' },
  { key: 'downloadsAndPulls', stat: 'download', label: 'downloads' },
  { key: 'activeUsers',      stat: 'users',    label: 'active users' },
  { key: 'totalProjects',    stat: 'projects', label: 'projects' },
] as const;

function injectDeltas(base: DashboardState, current: DashboardState): void {
  const relativeTime = `since ${formatRelativeTime(base.generatedAt)}`;

  for (const { key, stat, label } of HERO_MAP) {
    const delta = current.hero[key] - base.hero[key];
    if (delta === 0) continue;
    const tile = document.querySelector(`.stat[data-stat-key="${stat}"]`);
    const slot = tile?.querySelector<HTMLElement>('.stat-delta');
    if (slot) {
      injectDelta(slot, { value: Math.abs(delta), direction: delta > 0 ? 'up' : 'down', label }, relativeTime);
    }
  }

  for (const [source, profile] of Object.entries(current.profiles)) {
    const baseProfile = base.profiles[source];
    if (!baseProfile) continue;
    const chip = document.querySelector(`.profile-chip[data-profile-source="${source}"]`);
    if (!chip) continue;

    const headDelta = profile.headline.value - baseProfile.headline.value;
    if (headDelta !== 0) {
      const slot = chip.querySelector<HTMLElement>(`.stat-delta[data-fact-label="${CSS.escape(profile.headline.label)}"]`);
      if (slot) {
        injectDelta(slot, { value: Math.abs(headDelta), direction: headDelta > 0 ? 'up' : 'down', label: profile.headline.label }, relativeTime);
      }
    }
    for (const detail of profile.details) {
      const baseDetail = baseProfile.details.find((d) => d.label === detail.label);
      if (!baseDetail) continue;
      const delta = detail.value - baseDetail.value;
      if (delta === 0) continue;
      const slot = chip.querySelector<HTMLElement>(`.stat-delta[data-fact-label="${CSS.escape(detail.label)}"]`);
      if (slot) {
        injectDelta(slot, { value: Math.abs(delta), direction: delta > 0 ? 'up' : 'down', label: detail.label }, relativeTime);
      }
    }
  }

  const baseIds = new Set(Object.keys(base.projects));
  const currentIds = new Set(Object.keys(current.projects));
  let newCount = 0;
  for (const id of currentIds) {
    if (baseIds.has(id)) continue;
    newCount++;
    const card = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    const ribbon = card?.querySelector<HTMLElement>('.card-new-ribbon');
    if (ribbon) ribbon.removeAttribute('hidden');
  }
  let removedCount = 0;
  for (const id of baseIds) {
    if (!currentIds.has(id)) removedCount++;
  }
  if (newCount > 0 || removedCount > 0) {
    populateVisitSummary({ newProjectCount: newCount, removedProjectCount: removedCount, relativeTime });
  }
}

function init(): void {
  if (readHashParam('stats-demo')) return;
  const current = readCurrent();
  if (!current) return;

  const stored = readStored();
  if (!stored) {
    saveStored({ version: 1, diffBase: current, lastSeen: current });
    return;
  }

  if (stored.lastSeen.generatedAt !== current.generatedAt) {
    stored.diffBase = stored.lastSeen;
    stored.lastSeen = current;
    saveStored(stored);
  }

  if (stored.diffBase.generatedAt === current.generatedAt) return;
  injectDeltas(stored.diffBase, current);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
