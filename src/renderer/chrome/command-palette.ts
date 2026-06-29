// Command palette (Ctrl+Shift+P): a searchable list of every action with its current shortcut, run by
// click or Enter. Discoverability without memorizing chords. It runs commands supplied by the
// composition root (tiling actions + app actions) — it owns no domain logic itself.

export interface Command {
  /** stable id (for keys/tests) */
  id: string;
  /** what the user reads + searches on */
  title: string;
  /** the current shortcut to show on the right, e.g. "Alt+Shift+=" (optional) */
  hint?: string;
  run: () => void;
}

export interface CommandPalette {
  /** fixed overlay; mount at the document root */
  el: HTMLElement;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
}

/**
 * Filter + rank commands by a query: case-insensitive substring on the title, prefix matches first,
 * original order preserved within a tier (stable). Empty query returns everything unchanged. Pure.
 */
export function filterCommands(query: string, commands: Command[]): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands
    .map((c, i) => ({ c, i, at: c.title.toLowerCase().indexOf(q) }))
    .filter((s) => s.at >= 0)
    .sort((a, b) => (a.at === 0) === (b.at === 0) ? a.i - b.i : a.at === 0 ? -1 : 1)
    .map((s) => s.c);
}

export function createCommandPalette(getCommands: () => Command[]): CommandPalette {
  let open = false;
  let all: Command[] = []; // snapshot taken on open (chords are stable while the palette is up)
  let items: Command[] = []; // current filtered view
  let selected = 0;
  let lastFocus: Element | null = null;

  const overlay = document.createElement('div');
  overlay.className = 'command-palette-overlay fixed inset-0 z-[300] flex items-start justify-center pt-[14vh]';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Command palette');

  const dialog = document.createElement('div');
  dialog.className =
    'command-palette-dialog w-[min(560px,92vw)] max-h-[60vh] flex flex-col overflow-hidden ' +
    'rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-surface)]';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Run a command…';
  input.setAttribute('aria-label', 'Filter commands');
  input.className =
    'w-full px-3 h-10 shrink-0 bg-transparent outline-none border-b border-[var(--border)] ' +
    'text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-disabled)]';

  const list = document.createElement('div');
  list.className = 'command-palette-list flex-1 overflow-y-auto p-1';
  list.setAttribute('role', 'listbox');

  const emptyEl = document.createElement('div');
  emptyEl.className = 'px-3 py-4 text-[12px] text-[var(--text-disabled)] select-none';
  emptyEl.textContent = 'No matching commands';

  dialog.append(input, list);
  overlay.append(dialog);

  function renderItem(c: Command, i: number): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.tabIndex = -1; // focus stays on the input; Arrow keys navigate
    b.dataset.index = String(i);
    b.setAttribute('role', 'option');
    b.className =
      'command-palette-item w-full flex items-center gap-3 px-2.5 h-8 rounded-[var(--r-sm)] cursor-pointer text-left';
    const title = document.createElement('span');
    title.className = 'flex-1 min-w-0 truncate text-[13px] text-[var(--text-primary)]';
    title.textContent = c.title;
    b.append(title);
    if (c.hint) {
      const hint = document.createElement('span');
      hint.className = 'shrink-0 text-[11px] text-[var(--text-disabled)] font-mono';
      hint.textContent = c.hint;
      b.append(hint);
    }
    b.addEventListener('click', () => runAt(i));
    b.addEventListener('mousemove', () => {
      if (selected !== i) {
        selected = i;
        updateSelection();
      }
    });
    return b;
  }

  function renderList(): void {
    items = filterCommands(input.value, all);
    if (selected >= items.length) selected = Math.max(0, items.length - 1);
    if (items.length === 0) {
      list.replaceChildren(emptyEl);
      return;
    }
    list.replaceChildren(...items.map(renderItem));
    updateSelection();
  }

  function updateSelection(): void {
    [...list.children].forEach((el, i) => el.classList.toggle('is-selected', i === selected));
    (list.children[selected] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }

  function runAt(i: number): void {
    const cmd = items[i];
    doClose(); // hide + return focus to the terminal BEFORE running, so the action applies in context
    cmd?.run();
  }

  input.addEventListener('input', () => {
    selected = 0;
    renderList();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length) {
        selected = (selected + 1) % items.length;
        updateSelection();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length) {
        selected = (selected - 1 + items.length) % items.length;
        updateSelection();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items.length) runAt(selected);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      doClose();
    } else if (e.key === 'Tab') {
      e.preventDefault(); // trap focus on the input (no tabbing out to the underlying terminal)
    }
  });
  // Backdrop click (outside the dialog) closes.
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) doClose();
  });

  function doOpen(): void {
    if (open) return;
    open = true;
    lastFocus = document.activeElement;
    all = getCommands();
    input.value = '';
    selected = 0;
    renderList();
    overlay.classList.add('open');
    input.focus();
  }
  function doClose(): void {
    if (!open) return;
    open = false;
    overlay.classList.remove('open');
    if (lastFocus instanceof HTMLElement) lastFocus.focus();
    lastFocus = null;
  }

  return {
    el: overlay,
    open: doOpen,
    close: doClose,
    toggle: () => (open ? doClose() : doOpen()),
    isOpen: () => open,
  };
}
