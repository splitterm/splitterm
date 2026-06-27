// The dedicated settings modal: a JetBrains-style dialog with a left category rail and a content
// panel. Opened from the topbar gear or Ctrl+,. Sections write through immediately (live-apply),
// so there's no Save/Cancel — just Close. Content is (re)built on each open from a fresh snapshot.
import { Palette, SquareTerminal, Boxes, X, type IconNode } from 'lucide';
import { icon } from '../icons';
import { ipc } from '@platform/ipc-client';
import { createAppearanceSection } from './appearance-section';
import { createTerminalSection } from './terminal-section';
import { createProfilesSection } from './profiles-section';

type CategoryId = 'appearance' | 'terminal' | 'profiles';
const CATEGORIES: { id: CategoryId; label: string; glyph: IconNode }[] = [
  { id: 'appearance', label: 'Appearance', glyph: Palette },
  { id: 'terminal', label: 'Terminal', glyph: SquareTerminal },
  { id: 'profiles', label: 'Profiles', glyph: Boxes },
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

  async function rebuild(): Promise<void> {
    const cat = CATEGORIES.find((c) => c.id === active);
    headTitle.textContent = cat?.label ?? 'Settings';
    paintNav();
    if (active === 'profiles') {
      const [s, shells] = await Promise.all([ipc.settings.get(), ipc.pty.profiles().catch(() => [])]);
      body.replaceChildren(createProfilesSection(s, shells));
    } else {
      const s = await ipc.settings.get();
      body.replaceChildren(active === 'appearance' ? createAppearanceSection(s) : createTerminalSection(s));
    }
  }

  function select(id: CategoryId): void {
    active = id;
    void rebuild();
  }

  function open(): void {
    if (opened) return;
    opened = true;
    overlay.classList.add('open');
    void rebuild();
  }
  function close(): void {
    if (!opened) return;
    opened = false;
    overlay.classList.remove('open');
  }

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
