// Left push-drawer: the Sessions navigator — a live list of open terminals. Clicking a row focuses
// that pane; the × closes it. Fed by tiling.onChange via setSessions(). The push layout (occupying
// the body grid's first column, animating open) is unchanged. Configuration now lives in the
// dedicated settings modal, opened from the topbar gear.
import { SquareTerminal, X } from 'lucide';
import { icon } from './icons';
import type { PaneInfo } from '@features/tiling';

export interface Sidebar {
  /** the sidebar column content; mount as the body grid's first child */
  panel: HTMLElement;
  toggle(): void;
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** update the open-terminals list (from tiling.onChange) */
  setSessions(list: PaneInfo[]): void;
}

/** `layout` is the body grid element; opening toggles `sidebar-open` on it to animate the columns. */
export function createSidebar(
  layout: HTMLElement,
  opts: { onFocusPane: (leafId: string) => void; onClosePane: (leafId: string) => void },
): Sidebar {
  const panel = document.createElement('aside');
  panel.className = 'sidebar-panel';

  const inner = document.createElement('div');
  inner.className = 'sidebar-inner';

  const header = document.createElement('div');
  header.className =
    'h-9 flex items-center gap-2 px-3 shrink-0 border-b border-[var(--border)] ' +
    'text-[11px] font-semibold tracking-wide uppercase text-[var(--text-secondary)] select-none';
  header.append(icon(SquareTerminal, 15));
  const headerLabel = document.createElement('span');
  headerLabel.textContent = 'Sessions';
  header.append(headerLabel);

  const list = document.createElement('div');
  list.className = 'flex-1 overflow-y-auto p-2 flex flex-col gap-0.5';

  inner.append(header, list);
  panel.append(inner);

  let sessions: PaneInfo[] = [];

  function renderEmpty(): void {
    const empty = document.createElement('div');
    empty.className = 'flex flex-col items-center justify-center gap-1 py-8 text-center select-none';
    const t = document.createElement('div');
    t.className = 'text-[12px] text-[var(--text-secondary)]';
    t.textContent = 'No terminals open';
    const h = document.createElement('div');
    h.className = 'text-[11px] text-[var(--text-disabled)]';
    h.textContent = 'Press + to open one';
    empty.append(t, h);
    list.replaceChildren(empty);
  }

  function renderRow(p: PaneInfo, index: number): HTMLElement {
    const rowEl = document.createElement('div');
    rowEl.className =
      'group flex items-center gap-2 px-2 h-8 rounded-[var(--r-sm)] cursor-pointer ' +
      (p.focused ? 'bg-[var(--bg-active)] text-[var(--text-primary)]' : 'hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]');
    rowEl.addEventListener('click', () => opts.onFocusPane(p.leafId));

    rowEl.append(icon(SquareTerminal, 14));
    const name = document.createElement('span');
    name.className = 'flex-1 min-w-0 truncate text-[12px]';
    name.textContent = p.title || `Terminal ${index + 1}`;
    rowEl.append(name);

    const close = document.createElement('button');
    close.type = 'button';
    close.title = 'Close terminal';
    close.setAttribute('aria-label', 'Close terminal');
    close.className =
      'shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-[var(--r-sm)] cursor-pointer ' +
      'opacity-0 group-hover:opacity-100 text-[var(--text-secondary)] hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)]';
    close.appendChild(icon(X, 12));
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onClosePane(p.leafId);
    });
    rowEl.append(close);
    return rowEl;
  }

  function render(): void {
    if (sessions.length === 0) {
      renderEmpty();
      return;
    }
    list.replaceChildren(...sessions.map(renderRow));
  }

  render();

  // ---- open/close (push layout) ----
  let open = false;
  const apply = (): void => {
    layout.classList.toggle('sidebar-open', open);
  };
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
    setSessions(next) {
      sessions = next;
      render();
    },
  };
}
