// A left settings/nav panel. PUSH layout: it occupies the body's first grid column, which
// animates 0 → width and shifts the tiles right (it does NOT overlay them). The slide is a
// discrete ~170ms grid-template-columns transition; panes refit rAF-coalesced as the tile area
// resizes. Empty body for now.
import { Settings } from 'lucide';
import { icon } from './icons';

export interface Sidebar {
  /** the sidebar column content; mount as the body grid's first child */
  panel: HTMLElement;
  toggle(): void;
  open(): void;
  close(): void;
  isOpen(): boolean;
}

/** `layout` is the body grid element; opening toggles `sidebar-open` on it to animate the columns. */
export function createSidebar(layout: HTMLElement): Sidebar {
  const panel = document.createElement('aside');
  panel.className = 'sidebar-panel';

  const inner = document.createElement('div');
  inner.className = 'sidebar-inner';

  const header = document.createElement('div');
  header.className =
    'h-9 flex items-center gap-2 px-3 shrink-0 border-b border-[var(--border)] ' +
    'text-[11px] font-semibold tracking-wide uppercase text-[var(--text-secondary)] select-none';
  header.append(icon(Settings, 15));
  const label = document.createElement('span');
  label.textContent = 'Settings';
  header.append(label);

  const emptyState = document.createElement('div');
  emptyState.className = 'flex-1 flex items-center justify-center text-[11px] text-[var(--text-disabled)] select-none';
  emptyState.textContent = 'Nothing here yet';

  inner.append(header, emptyState);
  panel.append(inner);

  let open = false;
  const apply = (): void => {
    layout.classList.toggle('sidebar-open', open);
  };

  // Capture-phase Escape closes the panel and is consumed before reaching xterm/the shell.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        e.stopPropagation();
        open = false;
        apply();
      }
    },
    { capture: true },
  );

  return {
    panel,
    toggle() {
      open = !open;
      apply();
    },
    open() {
      open = true;
      apply();
    },
    close() {
      open = false;
      apply();
    },
    isOpen() {
      return open;
    },
  };
}
