// A custom, animated dropdown that replaces the native <select> in settings: themed options, a
// rotating chevron, and a fade+slide menu (collapsing to instant under reduce-motion via the motion
// tokens). Focus stays on the trigger — the ARIA combobox/listbox pattern with aria-activedescendant —
// so the settings modal's focus-trap keeps working. The menu is mounted into the settings overlay so it
// tears down with the modal (the shared dismiss signal) instead of leaking as a zombie + a listener.
import { ChevronDown, Check } from 'lucide';
import { icon } from '../icons';
import { onDismissPopovers } from './popover';

export interface DropdownOption {
  value: string;
  label: string;
}

let seq = 0;

const TRIGGER_CLASS =
  'app-dropdown inline-flex items-center justify-between gap-2 h-7 px-2 ' +
  'rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-input)] text-[12px] ' +
  'text-[var(--text-primary)] cursor-pointer outline-none ' +
  'hover:border-[var(--border-strong)] focus-visible:border-[var(--accent)] ' +
  'disabled:opacity-50 disabled:cursor-not-allowed ' +
  'transition-colors ease-[var(--ease-out)] duration-[var(--motion-fast)]';

/**
 * Build a custom dropdown. Returns the trigger <button> (so `.disabled` works natively and `row()` can
 * append it like the native control it replaces). The current value is mirrored to `dataset.value`.
 */
export function createDropdown(opts: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** min-width of the trigger (e.g. '160px'); the menu is always at least as wide as the trigger */
  minWidth?: string;
  ariaLabel?: string;
}): HTMLButtonElement {
  const baseId = `dd-${++seq}`;
  let value = opts.value;
  let menu: HTMLElement | null = null;
  let optionEls: HTMLElement[] = [];
  let highlight = -1;
  let offDismiss = (): void => {};
  let typeBuf = '';
  let typeTimer = 0;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = TRIGGER_CLASS;
  if (opts.minWidth) trigger.style.minWidth = opts.minWidth;
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  if (opts.ariaLabel) trigger.setAttribute('aria-label', opts.ariaLabel);
  trigger.disabled = opts.disabled ?? false;

  const labelEl = document.createElement('span');
  labelEl.className = 'app-dropdown__label';
  const chevron = icon(ChevronDown, 14);
  chevron.classList.add('app-dropdown__chevron');
  trigger.append(labelEl, chevron);

  const labelOf = (v: string): string => opts.options.find((o) => o.value === v)?.label ?? '';
  const paintLabel = (): void => {
    labelEl.textContent = labelOf(value);
    trigger.dataset.value = value; // expose the current value for any caller that needs to read it
  };
  paintLabel();

  const onDocDown = (e: PointerEvent): void => {
    const t = e.target as Node;
    if (menu && !menu.contains(t) && !trigger.contains(t)) close();
  };

  function setHighlight(i: number): void {
    highlight = i;
    optionEls.forEach((el, idx) => el.classList.toggle('is-active', idx === i));
    const el = optionEls[i];
    if (el) {
      trigger.setAttribute('aria-activedescendant', el.id);
      el.scrollIntoView({ block: 'nearest' });
    } else {
      trigger.removeAttribute('aria-activedescendant');
    }
  }

  function position(): void {
    if (!menu) return;
    const r = trigger.getBoundingClientRect();
    menu.style.minWidth = `${r.width}px`;
    menu.style.left = `${r.left}px`;
    menu.style.top = `${r.bottom + 4}px`;
    // Flip / clamp into the viewport once laid out (mirrors the colour-picker popover).
    requestAnimationFrame(() => {
      if (!menu) return;
      const m = menu.getBoundingClientRect();
      if (m.right > window.innerWidth - 8) menu.style.left = `${Math.max(8, window.innerWidth - m.width - 8)}px`;
      if (m.bottom > window.innerHeight - 8 && r.top - m.height - 4 > 8) {
        menu.style.top = `${r.top - m.height - 4}px`;
        menu.style.transformOrigin = 'bottom';
      }
    });
  }

  function open(): void {
    if (menu || trigger.disabled || opts.options.length === 0) return;
    menu = document.createElement('div');
    menu.className = 'app-pop-menu app-dropdown-menu';
    menu.setAttribute('role', 'listbox');
    if (opts.ariaLabel) menu.setAttribute('aria-label', opts.ariaLabel);

    optionEls = opts.options.map((o, i) => {
      const el = document.createElement('div');
      el.id = `${baseId}-opt-${i}`;
      el.className = 'app-dropdown-option';
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', String(o.value === value));
      const check = icon(Check, 14);
      check.classList.add('app-dropdown-option__check');
      const lab = document.createElement('span');
      lab.className = 'app-dropdown-option__label';
      lab.textContent = o.label;
      el.append(check, lab);
      el.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus on the trigger
      el.addEventListener('mouseenter', () => setHighlight(i));
      el.addEventListener('click', () => commit(o.value));
      return el;
    });
    menu.append(...optionEls);

    const host = trigger.closest('.settings-overlay') ?? document.body;
    host.appendChild(menu);
    position();

    trigger.setAttribute('aria-expanded', 'true');
    trigger.classList.add('app-dropdown--open');
    setHighlight(Math.max(0, opts.options.findIndex((o) => o.value === value)));
    requestAnimationFrame(() => menu?.classList.add('open')); // animate in on the next frame

    document.addEventListener('pointerdown', onDocDown, true);
    offDismiss = onDismissPopovers(close);
  }

  function close(): void {
    if (!menu) return;
    const m = menu;
    menu = null;
    optionEls = [];
    highlight = -1;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.classList.remove('app-dropdown--open');
    trigger.removeAttribute('aria-activedescendant');
    document.removeEventListener('pointerdown', onDocDown, true);
    offDismiss();
    offDismiss = (): void => {};
    m.classList.remove('open'); // animate out, then remove
    m.addEventListener('transitionend', () => m.remove(), { once: true });
    window.setTimeout(() => m.remove(), 250); // failsafe if transitionend never fires (e.g. reduce-motion)
  }

  function commit(v: string): void {
    if (v !== value) {
      value = v;
      paintLabel();
      opts.onChange(v);
    }
    close();
    trigger.focus();
  }

  function typeahead(ch: string): void {
    typeBuf += ch.toLowerCase();
    window.clearTimeout(typeTimer);
    typeTimer = window.setTimeout(() => (typeBuf = ''), 600);
    const idx = opts.options.findIndex((o) => o.label.toLowerCase().startsWith(typeBuf));
    if (idx >= 0) setHighlight(idx);
  }

  const wrap = (i: number): number => (i + opts.options.length) % opts.options.length;

  trigger.addEventListener('click', () => (menu ? close() : open()));
  trigger.addEventListener('keydown', (e) => {
    if (trigger.disabled) return;
    if (!menu) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlight(wrap(highlight + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlight(wrap(highlight - 1));
        break;
      case 'Home':
        e.preventDefault();
        setHighlight(0);
        break;
      case 'End':
        e.preventDefault();
        setHighlight(opts.options.length - 1);
        break;
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const picked = opts.options[highlight];
        if (picked) commit(picked.value);
        break;
      }
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close();
        trigger.focus();
        break;
      case 'Tab':
        close(); // let Tab move focus on naturally
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          typeahead(e.key);
        }
    }
  });

  return trigger;
}
