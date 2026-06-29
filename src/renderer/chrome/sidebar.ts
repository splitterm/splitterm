// Left push-drawer: the Sessions navigator — a live list of open terminals. Clicking a row focuses
// that pane; the × closes it. Fed by tiling.onChange via setSessions(). The push layout (occupying
// the body grid's first column, animating open) is unchanged. Configuration now lives in the
// dedicated settings modal, opened from the topbar gear.
import { SquareTerminal, X } from 'lucide';
import { icon } from './icons';
import type { PaneInfo } from '@features/tiling';

const STATUS_LABEL: Record<string, string> = {
  claudeWorking: 'Working',
  working: 'Active',
  attention: 'Needs input',
  idle: 'Idle',
  exited: 'Exited',
};
// Which statuses show a text label next to the dot. Generic 'working' (e.g. your own typing echoing)
// is deliberately label-less — only Claude working / needs-input / exited get a prominent word.
const STATUS_SHOWS_TEXT = new Set(['claudeWorking', 'attention', 'exited']);

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
  opts: {
    onFocusPane: (leafId: string) => void;
    onClosePane: (leafId: string) => void;
    /** when this returns true (e.g. the settings modal is open), Escape is left for that layer */
    isBlocked?: () => boolean;
  },
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
  // Rendered rows keyed by leafId (Map keeps render order). A 'cosmetic' refresh (status/title) reuses
  // these and mutates in place; only a structural change (add/remove/reorder) rebuilds the list — so a
  // focused row, or a mid-click on the × button, survives the frequent status updates.
  const rendered = new Map<string, { el: HTMLElement; update: (p: PaneInfo, index: number) => void }>();

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

  // Build a row once; `update` mutates only its dynamic bits (title, status dot/word, focus styling)
  // so a status refresh never recreates the element — leafId is fixed, so the handlers capture it once.
  function renderRow(leafId: string): { el: HTMLElement; update: (p: PaneInfo, index: number) => void } {
    // A clickable row whose primary action (focus this terminal) must be keyboard-reachable, so it
    // gets role=button + tabindex + Enter/Space — not just a click handler on a bare <div>.
    const rowEl = document.createElement('div');
    rowEl.setAttribute('role', 'button');
    rowEl.tabIndex = 0;
    rowEl.className =
      'group flex items-center gap-2 px-2 h-8 rounded-[var(--r-sm)] cursor-pointer ' +
      'outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]';
    rowEl.addEventListener('click', () => opts.onFocusPane(leafId));
    rowEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        opts.onFocusPane(leafId);
      }
    });

    // Leading activity dot: working (pulsing accent) / attention (amber) / idle (dim) / exited (red).
    const dot = document.createElement('span');
    dot.className = 'pane-status-dot shrink-0';

    const name = document.createElement('span');
    name.className = 'flex-1 min-w-0 truncate text-[12px]';

    // A small status word on the right (blank for plain idle to keep the row calm).
    const statusText = document.createElement('span');
    statusText.className = 'pane-status-text shrink-0 text-[10px] text-[var(--text-disabled)]';

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
      opts.onClosePane(leafId);
    });

    rowEl.append(dot, icon(SquareTerminal, 14), name, statusText, close);

    const update = (p: PaneInfo, index: number): void => {
      const label = p.title || `Terminal ${index + 1}`;
      const statusLabel = STATUS_LABEL[p.status] ?? '';
      name.textContent = label;
      rowEl.setAttribute('aria-label', `Focus ${label} — ${statusLabel}`);
      dot.dataset.status = p.status;
      dot.title = statusLabel;
      statusText.textContent = STATUS_SHOWS_TEXT.has(p.status) ? statusLabel : '';
      statusText.dataset.status = p.status;
      rowEl.classList.toggle('row-claude-working', p.status === 'claudeWorking'); // prominent Claude tint
      rowEl.classList.toggle('bg-[var(--bg-active)]', p.focused);
      rowEl.classList.toggle('text-[var(--text-primary)]', p.focused);
      rowEl.classList.toggle('hover:bg-[var(--bg-hover)]', !p.focused);
      rowEl.classList.toggle('text-[var(--text-secondary)]', !p.focused);
    };
    return { el: rowEl, update };
  }

  function render(): void {
    if (sessions.length === 0) {
      rendered.clear();
      renderEmpty();
      return;
    }
    // Reuse existing rows when the leafId sequence is unchanged (a cosmetic status/title refresh) —
    // mutate in place. Rebuild only when panes were added/removed/reordered (a structural change).
    const ids = sessions.map((s) => s.leafId);
    const prev = [...rendered.keys()];
    const sameSequence = ids.length === prev.length && ids.every((id, i) => prev[i] === id);
    if (sameSequence) {
      sessions.forEach((p, i) => rendered.get(p.leafId)?.update(p, i));
      return;
    }
    rendered.clear();
    const rows = sessions.map((p, i) => {
      const row = renderRow(p.leafId);
      row.update(p, i);
      rendered.set(p.leafId, row);
      return row.el;
    });
    list.replaceChildren(...rows);
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
      // Leave Escape to the top-most layer: if the settings modal is open, it owns this keystroke.
      if (e.key === 'Escape' && open && !opts.isBlocked?.()) {
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
