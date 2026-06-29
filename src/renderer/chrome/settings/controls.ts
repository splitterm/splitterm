// Small form primitives shared by the settings sections — a labeled row, a section heading, and
// themed select / number / text / toggle / colour controls. Keeps the sections declarative.
import { createColorPicker } from './color-picker';
import type { StatusAnim } from '@shared/domain/status-appearance';

// Fired on `document` by the settings modal (close / category switch) so any open colour-picker popover
// tears down with the modal — closing every path, not just the pointer ones.
const COLOR_POPOVER_DISMISS = 'settings:dismiss-color-popover';
export function dismissColorPopovers(): void {
  document.dispatchEvent(new Event(COLOR_POPOVER_DISMISS));
}

export const FIELD =
  'h-7 px-2 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-input)] text-[12px] ' +
  'text-[var(--text-primary)] placeholder:text-[var(--text-disabled)] outline-none focus:border-[var(--accent)]';

/** A label (+ optional hint) on the left, a control on the right. */
export function row(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex items-center justify-between gap-6 py-2';
  const left = document.createElement('div');
  left.className = 'flex flex-col gap-0.5 min-w-0';
  const l = document.createElement('div');
  l.className = 'text-[12px] text-[var(--text-primary)]';
  l.textContent = label;
  left.append(l);
  if (hint) {
    const h = document.createElement('div');
    h.className = 'text-[11px] leading-snug text-[var(--text-disabled)]';
    h.textContent = hint;
    left.append(h);
  }
  // The visible label sits in a sibling div, so give the control an accessible name from it (unless
  // the caller already set one) — otherwise a screen reader announces a bare "switch"/"combo box".
  if (!control.hasAttribute('aria-label') && !control.hasAttribute('aria-labelledby')) {
    control.setAttribute('aria-label', label);
  }
  control.classList.add('shrink-0');
  wrap.append(left, control);
  return wrap;
}

export function sectionHeading(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className =
    'text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] pt-4 pb-1 ' +
    'first:pt-0 border-b border-[var(--border)] mb-1';
  el.textContent = text;
  return el;
}

export function selectControl(opts: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className =
    FIELD + ' min-w-[160px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
  for (const o of opts.options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    sel.append(opt);
  }
  sel.value = opts.value;
  sel.disabled = opts.disabled ?? false;
  sel.addEventListener('change', () => opts.onChange(sel.value));
  return sel;
}

/** Animation picker for a status state: '' = Default (inherit), else Pulse / Static. */
export function animSelect(value: StatusAnim | '', onChange: (v: StatusAnim | '') => void): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = FIELD + ' cursor-pointer';
  sel.setAttribute('aria-label', 'Animation');
  for (const o of [
    { value: '', label: 'Default' },
    { value: 'pulse', label: 'Pulse' },
    { value: 'static', label: 'Static' },
  ]) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    sel.append(opt);
  }
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value as StatusAnim | ''));
  return sel;
}

export function numberControl(opts: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'number';
  el.className = FIELD + ' w-20';
  if (opts.min != null) el.min = String(opts.min);
  if (opts.max != null) el.max = String(opts.max);
  if (opts.step != null) el.step = String(opts.step);
  el.value = String(opts.value);
  el.addEventListener('change', () => {
    let n = Number(el.value);
    if (Number.isNaN(n)) {
      el.value = String(opts.value);
      return;
    }
    if (opts.min != null) n = Math.max(opts.min, n);
    if (opts.max != null) n = Math.min(opts.max, n);
    el.value = String(n);
    opts.onChange(n);
  });
  return el;
}

export function textControl(opts: {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'text';
  el.className = FIELD + ' min-w-[240px]';
  el.value = opts.value;
  if (opts.placeholder) el.placeholder = opts.placeholder;
  el.addEventListener('change', () => opts.onChange(el.value));
  return el;
}

/**
 * A colour swatch (#hex) with a "Default" reset. `value` of '' means "use the theme default", in which
 * case the swatch previews `fallback`; onChange fires '' on reset, else the picked #rrggbb.
 */
export function colorControl(opts: { value: string; fallback: string; onChange: (value: string) => void }): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex items-center gap-2';
  let current = opts.value || opts.fallback; // the live #hex shown in the swatch

  const swatch = document.createElement('button');
  swatch.type = 'button';
  swatch.setAttribute('aria-label', 'Pick a colour');
  swatch.className = 'h-7 w-9 rounded-[var(--r-sm)] border border-[var(--border)] cursor-pointer';
  swatch.style.background = current;

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Default';
  reset.className =
    'h-7 px-2 rounded-[var(--r-sm)] border border-[var(--border)] text-[11px] cursor-pointer ' +
    'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]';

  // The picker opens as a popover anchored under the swatch, mounted in the settings overlay so it's
  // hidden with the modal (+ not clipped by the dialog's overflow). Its lifetime is tied to the modal:
  // outside pointerdown, swatch re-click, Default, OR a dismiss event the modal fires on close/category
  // switch (so a keyboard close — Escape / Ctrl+, — can't leave a zombie popover + a leaked listener).
  let pop: HTMLElement | null = null;
  const onDocDown = (e: PointerEvent): void => {
    if (pop && !pop.contains(e.target as Node) && e.target !== swatch) closePop();
  };
  function closePop(): void {
    pop?.remove();
    pop = null;
    document.removeEventListener('pointerdown', onDocDown, true);
    document.removeEventListener(COLOR_POPOVER_DISMISS, closePop);
  }
  swatch.addEventListener('click', () => {
    if (pop) {
      closePop();
      return;
    }
    const picker = createColorPicker(current, (hex) => {
      current = hex;
      swatch.style.background = hex;
      opts.onChange(hex);
    });
    pop = document.createElement('div');
    pop.className = 'fixed z-[400] p-3 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-surface)]';
    pop.style.boxShadow = '0 8px 28px -8px rgba(0,0,0,.55)';
    pop.append(picker.el);
    (swatch.closest('.settings-overlay') ?? document.body).append(pop);
    const r = swatch.getBoundingClientRect();
    pop.style.left = `${r.left}px`;
    pop.style.top = `${r.bottom + 6}px`;
    requestAnimationFrame(() => {
      if (!pop) return;
      const pr = pop.getBoundingClientRect();
      if (pr.right > window.innerWidth - 8) pop.style.left = `${window.innerWidth - pr.width - 8}px`;
      if (pr.bottom > window.innerHeight - 8) pop.style.top = `${r.top - pr.height - 6}px`;
      pop.querySelector<HTMLInputElement>('input[aria-label="Hex colour"]')?.focus(); // keyboard entry point
    });
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener(COLOR_POPOVER_DISMISS, closePop);
  });

  reset.addEventListener('click', () => {
    current = opts.fallback;
    swatch.style.background = current;
    opts.onChange('');
    closePop();
  });

  wrap.append(swatch, reset);
  return wrap;
}

/** A multi-line text field (one value per line). Used for profile command sequences. */
export function textareaControl(opts: {
  value: string;
  placeholder?: string;
  rows?: number;
  onChange: (value: string) => void;
}): HTMLTextAreaElement {
  const el = document.createElement('textarea');
  el.className =
    'px-2 py-1.5 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-input)] text-[12px] ' +
    'text-[var(--text-primary)] placeholder:text-[var(--text-disabled)] outline-none focus:border-[var(--accent)] ' +
    'resize-y leading-snug font-mono';
  el.rows = opts.rows ?? 2;
  el.value = opts.value;
  if (opts.placeholder) el.placeholder = opts.placeholder;
  el.addEventListener('change', () => opts.onChange(el.value));
  return el;
}

/** An iOS-style switch. Mirrors `aria-checked` so the e2e (and a11y tools) can read its state. */
export function toggle(opts: { checked: boolean; onChange: (value: boolean) => void }): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('role', 'switch');
  let checked = opts.checked;

  const knob = document.createElement('span');
  const paint = (): void => {
    btn.setAttribute('aria-checked', String(checked));
    btn.className =
      'app-no-drag relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full cursor-pointer ' +
      'transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] ' +
      (checked ? 'bg-[var(--accent)]' : 'bg-[var(--bg-active)]');
    knob.className =
      'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ' +
      'duration-[var(--motion-fast)] ease-[var(--ease-out)] ' +
      (checked ? 'translate-x-[15px]' : 'translate-x-[2px]');
  };
  btn.append(knob);
  paint();

  btn.addEventListener('click', () => {
    checked = !checked;
    paint();
    opts.onChange(checked);
  });
  return btn;
}
