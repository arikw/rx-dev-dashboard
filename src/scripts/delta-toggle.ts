const STORAGE_KEY = 'delta-visibility';

function countChanges(): number {
  let n = 0;
  n += document.querySelectorAll('.stat-delta:not([hidden])').length;
  n += document.querySelectorAll('.card-new-ribbon:not([hidden])').length;
  return n;
}

function shouldShowToggle(): boolean {
  if (countChanges() > 0) return true;
  const summary = document.querySelector<HTMLElement>('.visit-summary');
  return !!(summary && !summary.hidden);
}

function applyVisibilityState(hidden: boolean): void {
  document.body.classList.toggle('changes-hidden', hidden);
}

function readStoredHidden(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'hidden';
  } catch {
    return false;
  }
}

function storeHidden(hidden: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, hidden ? 'hidden' : 'visible');
  } catch {
    /* private mode / storage disabled — state still applies for this session */
  }
}

function init(): void {
  const btn = document.querySelector<HTMLButtonElement>('[data-delta-toggle]');
  if (!btn) return;

  queueMicrotask(() => {
    if (!shouldShowToggle()) return;
    const total = countChanges();

    const hidden = readStoredHidden();
    applyVisibilityState(hidden);

    btn.dataset.tooltip = `${total} change${total === 1 ? '' : 's'} since last visit`;
    btn.hidden = false;

    btn.addEventListener('click', () => {
      const next = !document.body.classList.contains('changes-hidden');
      applyVisibilityState(next);
      storeHidden(next);
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
