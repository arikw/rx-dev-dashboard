let tooltip: HTMLElement | null = null;
let active: Element | null = null;

function getTooltip(): HTMLElement {
  if (tooltip) return tooltip;
  tooltip = document.createElement('span');
  tooltip.className = 'stat-info-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  document.body.appendChild(tooltip);
  return tooltip;
}

function position(trigger: Element): void {
  const tip = getTooltip();
  const rect = trigger.getBoundingClientRect();
  const tipW = tip.offsetWidth;
  const tipH = tip.offsetHeight;
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const htmlLeft = document.documentElement.getBoundingClientRect().left;
  const triggerCenterX = rect.left + rect.width / 2;

  let leftV = triggerCenterX - tipW / 2;
  leftV = Math.max(pad, Math.min(leftV, vw - tipW - pad));

  let topV = rect.bottom + 8;
  const flipUp = topV + tipH > vh - pad;
  if (flipUp) topV = rect.top - tipH - 8;
  tip.classList.toggle('flip-up', flipUp);

  tip.style.left = `${leftV - htmlLeft}px`;
  tip.style.top = `${topV}px`;
  tip.style.setProperty('--arrow-left', `${triggerCenterX - leftV}px`);
}

function show(trigger: Element): void {
  const text = trigger.getAttribute('data-tooltip');
  if (!text) return;
  const tip = getTooltip();
  tip.textContent = text;
  active = trigger;
  position(trigger);
  tip.classList.add('show');
}

function hide(): void {
  active = null;
  tooltip?.classList.remove('show');
}

function init(): void {
  document.addEventListener('mouseover', (e) => {
    if (!(e.target instanceof Element)) return;
    const chip = e.target.closest('.stat-delta[data-tooltip]');
    if (chip && chip !== active) show(chip);
  });
  document.addEventListener('mouseout', (e) => {
    if (!(e.target instanceof Element)) return;
    const chip = e.target.closest('.stat-delta[data-tooltip]');
    if (!chip) return;
    const related = (e as MouseEvent).relatedTarget;
    if (related instanceof Element && chip.contains(related)) return;
    hide();
  });
  document.addEventListener('touchstart', (e) => {
    if (!(e.target instanceof Element)) return;
    const chip = e.target.closest('.stat-delta[data-tooltip]');
    if (chip) {
      show(chip);
    } else if (!e.target.closest('.stat-info-tooltip')) {
      hide();
    }
  }, { passive: true });
  window.addEventListener('scroll', hide, { passive: true });
  window.addEventListener('touchmove', hide, { passive: true });
  window.addEventListener('resize', () => {
    if (active) position(active);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
