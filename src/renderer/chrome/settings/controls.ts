// Small form primitives shared by the settings sections — a labeled row, a section heading, and
// themed select / number / text / toggle controls. Keeps the sections declarative and consistent.

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
