// The dedicated settings modal: a JetBrains-style dialog with a left category rail and a content
// panel. Opened from the topbar gear or Ctrl+,. Sections write through immediately (live-apply),
// so there's no Save/Cancel — just Close. Content is (re)built on each open from a fresh snapshot.
import { Palette, SquareTerminal, Boxes, Keyboard, SlidersHorizontal, X, type IconNode } from 'lucide';
import { icon } from '../icons';
import { ipc } from '@platform/ipc-client';
import { getSettings } from '@platform/settings-controller';
import { createAppearanceSection } from './appearance-section';
import { createTerminalSection } from './terminal-section';
import { createProfilesSection } from './profiles-section';
import { createKeyboardSection } from './keyboard-section';
import { createGeneralSection } from './general-section';

type CategoryId = 'appearance' | 'terminal' | 'profiles' | 'keyboard' | 'general';
const CATEGORIES: { id: CategoryId; label: string; glyph: IconNode }[] = [
  { id: 'appearance', label: 'Appearance', glyph: Palette },
  { id: 'terminal', label: 'Terminal', glyph: SquareTerminal },
  { id: 'profiles', label: 'Profiles', glyph: Boxes },
  { id: 'keyboard', label: 'Keyboard', glyph: Keyboard },
  { id: 'general', label: 'General', glyph: SlidersHorizontal },
];

export interface SettingsModal {
  el: HTMLElement;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
}

export function createSettingsModal(): SettingsModal {
  let active: CategoryId = 'appearance';
  let opened = false;

  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay app-no-drag fixed inset-0 z-[200] flex items-center justify-center';

  const backdrop = document.createElement('div');
  backdrop.className = 'settings-backdrop absolute inset-0 bg-black/50';
  backdrop.addEventListener('click', () => close());

  const dialog = document.createElement('div');
  dialog.className =
    'settings-dialog relative flex w-[820px] max-w-[92vw] h-[560px] max-h-[88vh] overflow-hidden ' +
    'rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--bg-surface)] ' +
    'shadow-[0_24px_64px_rgba(0,0,0,0.5)]';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'settings-dialog-title');

  // ---- left rail ----
  const rail = document.createElement('div');
  rail.className = 'flex flex-col w-[200px] shrink-0 p-2 gap-0.5 border-r border-[var(--border)] bg-[var(--bg-app)]';
  const railTitle = document.createElement('div');
  railTitle.className = 'px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] select-none';
  railTitle.textContent = 'Settings';
  rail.append(railTitle);

  const navButtons = new Map<CategoryId, HTMLButtonElement>();
  for (const cat of CATEGORIES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.category = cat.id;
    btn.append(icon(cat.glyph, 15));
    const span = document.createElement('span');
    span.textContent = cat.label;
    btn.append(span);
    btn.addEventListener('click', () => select(cat.id));
    navButtons.set(cat.id, btn);
    rail.append(btn);
  }

  // ---- content ----
  const content = document.createElement('div');
  content.className = 'flex flex-col flex-1 min-w-0';
  const head = document.createElement('div');
  head.className = 'flex items-center justify-between h-11 px-4 shrink-0 border-b border-[var(--border)]';
  const headTitle = document.createElement('div');
  headTitle.id = 'settings-dialog-title'; // names the dialog (aria-labelledby); updates per section
  headTitle.className = 'text-[13px] font-semibold text-[var(--text-primary)]';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.title = 'Close settings';
  closeBtn.setAttribute('aria-label', 'Close settings');
  closeBtn.className =
    'inline-flex items-center justify-center w-7 h-7 rounded-[var(--r-sm)] cursor-pointer ' +
    'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] ' +
    'transition-colors ease-[var(--ease-out)] duration-[var(--motion-fast)]';
  closeBtn.appendChild(icon(X, 16));
  closeBtn.addEventListener('click', () => close());
  head.append(headTitle, closeBtn);

  const body = document.createElement('div');
  body.className = 'flex-1 overflow-y-auto px-4 py-3';

  content.append(head, body);
  dialog.append(rail, content);
  overlay.append(backdrop, dialog);

  function paintNav(): void {
    for (const [id, btn] of navButtons) {
      const on = id === active;
      btn.className =
        'flex items-center gap-2.5 px-2.5 h-8 rounded-[var(--r-sm)] text-[12px] cursor-pointer text-left ' +
        'transition-colors ease-[var(--ease-out)] duration-[var(--motion-fast)] ' +
        (on
          ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]');
    }
  }

  let rebuildSeq = 0;
  async function rebuild(): Promise<void> {
    const gen = ++rebuildSeq;
    const cat = CATEGORIES.find((c) => c.id === active);
    headTitle.textContent = cat?.label ?? 'Settings';
    paintNav();
    // Appearance/Terminal render synchronously from the live snapshot the settings-controller keeps
    // current, so the rail highlight and the body can never disagree. Profiles also needs the
    // detected-shell list, so it awaits that one IPC — guarded so a superseded rebuild can't win the
    // race and paint a stale section after a quicker, later-clicked category already rendered.
    const s = getSettings();
    if (active === 'appearance') {
      body.replaceChildren(createAppearanceSection(s));
    } else if (active === 'terminal') {
      body.replaceChildren(createTerminalSection(s));
    } else if (active === 'keyboard') {
      body.replaceChildren(createKeyboardSection(s));
    } else if (active === 'general') {
      body.replaceChildren(createGeneralSection(s));
    } else {
      // profiles — also needs the detected-shell list (async, generation-guarded)
      const shells = await ipc.pty.profiles().catch(() => []);
      if (gen !== rebuildSeq) return; // a newer rebuild started while we awaited — drop this one
      body.replaceChildren(createProfilesSection(getSettings(), shells));
    }
  }

  function select(id: CategoryId): void {
    active = id;
    void rebuild();
  }

  let lastFocused: HTMLElement | null = null;
  function open(): void {
    if (opened) return;
    opened = true;
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlay.classList.add('open');
    void rebuild();
    // Pull focus into the dialog. Without this, opening via Ctrl+, leaves focus on the xterm behind
    // the backdrop and the user's keystrokes go to that terminal. The active nav button always exists.
    navButtons.get(active)?.focus();
  }
  function close(): void {
    if (!opened) return;
    opened = false;
    overlay.classList.remove('open');
    lastFocused?.focus(); // restore focus to whatever opened it (the gear, or the focused terminal)
    lastFocused = null;
  }

  // Focus trap: keep Tab inside the dialog while open. The dimmed background is still in the tab
  // order, so without this Tab would walk into the terminal/topbar behind the modal.
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusables = [...dialog.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )].filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && opened) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    },
    { capture: true },
  );

  paintNav();
  return {
    el: overlay,
    open,
    close,
    toggle() {
      if (opened) close();
      else open();
    },
    isOpen() {
      return opened;
    },
  };
}
