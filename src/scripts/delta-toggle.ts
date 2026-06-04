const STORAGE_KEY = 'delta-visibility';

function countChanges(): number {
  let n = 0;
  n += document.querySelectorAll('.stat-delta:not([hidden])').length;
  n += document.querySelectorAll('.card-new-ribbon:not([hidden])').length;
  const summary = document.querySelector<HTMLElement>('.visit-summary');
  if (summary && !summary.hidden) n += 1;
  return n;
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
    const total = countChanges();
    if (total === 0) return;

    const hidden = readStoredHidden();
    applyVisibilityState(hidden);

    const updateLabel = (): void => {
      const isHidden = document.body.classList.contains('changes-hidden');
      const action = isHidden ? 'show' : 'hide';
      btn.dataset.tooltip = `${total} change${total === 1 ? '' : 's'} since last visit — click to ${action}`;
    };
    updateLabel();
    btn.hidden = false;

    btn.addEventListener('click', () => {
      const next = !document.body.classList.contains('changes-hidden');
      applyVisibilityState(next);
      storeHidden(next);
      updateLabel();
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
