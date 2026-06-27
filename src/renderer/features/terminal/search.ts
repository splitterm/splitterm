// Per-pane scrollback search: a small overlay bar (Ctrl+F / Ctrl+Shift+F) driving a SearchAddon on
// this terminal. Owned entirely by the terminal feature — no app-level keybinding and no IPC. The
// bar is a position:absolute child of the term-pane (clipped to it), hidden until opened. Enter /
// Shift+Enter step through matches, Escape closes and returns focus to the terminal. Match colors
// come from the theme tokens; the overview-ruler colors are supplied only to satisfy the addon's
// type — overviewRulerWidth is left unset, so no ruler is reserved and the terminal stays clean.
import type { Terminal } from '@xterm/xterm';
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search';
import { ChevronUp, ChevronDown, X, createElement, type IconNode } from 'lucide';

const icon = (node: IconNode, size = 14): SVGElement => {
  const svg = createElement(node);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  return svg;
};

export interface TerminalSearch {
  /** the overlay element; append into the term-pane (hidden until opened) */
  el: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

export function createTerminalSearch(term: Terminal): TerminalSearch {
  const search = new SearchAddon();
  term.loadAddon(search);

  const cssVar = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // Re-read on each search so a live theme change is picked up.
  const options = (incremental: boolean): ISearchOptions => ({
    incremental,
    decorations: {
      matchBackground: cssVar('--term-search-match'),
      activeMatchBackground: cssVar('--term-search-active'),
      activeMatchBorder: cssVar('--term-search-active'),
      matchOverviewRuler: cssVar('--term-search-match'),
      activeMatchColorOverviewRuler: cssVar('--term-search-active'),
    },
  });

  // ---- DOM ----
  const el = document.createElement('div');
  el.setAttribute('role', 'search');
  el.className =
    'term-search app-no-drag absolute top-2 right-2 z-10 hidden items-center gap-1 h-8 pl-2 pr-1 ' +
    'rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-elevated)] ' +
    'shadow-[0_8px_24px_rgba(0,0,0,0.36)]';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Find';
  input.setAttribute('aria-label', 'Find in terminal');
  input.className =
    'bg-transparent outline-none text-[12px] text-[var(--text-primary)] ' +
    'placeholder:text-[var(--text-disabled)] w-40';

  const count = document.createElement('span');
  count.className = 'term-search-count text-[11px] text-[var(--text-secondary)] tabular-nums min-w-[48px] text-right px-1';

  const button = (glyph: IconNode, label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.className =
      'inline-flex items-center justify-center w-6 h-6 shrink-0 rounded-[var(--r-sm)] cursor-pointer ' +
      'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] ' +
      'transition-colors ease-[var(--ease-out)] duration-[var(--motion-fast)] motion-reduce:transition-none';
    b.appendChild(icon(glyph));
    // Keep focus in the input when clicking a button, so the user can keep typing.
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', onClick);
    return b;
  };

  let open = false;

  function find(forward: boolean, incremental = false): void {
    const q = input.value;
    if (!q) {
      search.clearDecorations();
      count.textContent = '';
      return;
    }
    const opts = options(incremental);
    if (forward) search.findNext(q, opts);
    else search.findPrevious(q, opts);
  }

  const prev = button(ChevronUp, 'Previous match (Shift+Enter)', () => find(false));
  const next = button(ChevronDown, 'Next match (Enter)', () => find(true));
  const closeBtn = button(X, 'Close (Escape)', () => close());
  el.append(input, count, prev, next, closeBtn);

  const sub = search.onDidChangeResults(({ resultIndex, resultCount }) => {
    if (!input.value) {
      count.textContent = '';
      return;
    }
    count.textContent = resultCount === 0 ? 'No results' : `${resultIndex + 1}/${resultCount}`;
  });

  input.addEventListener('input', () => find(true, true)); // incremental as you type
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      find(!e.shiftKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });

  function openSearch(): void {
    open = true;
    el.classList.remove('hidden');
    el.classList.add('flex');
    input.focus();
    input.select();
    if (input.value) find(true, true); // re-run a previous query on reopen
  }
  function close(): void {
    if (!open) return;
    open = false;
    el.classList.add('hidden');
    el.classList.remove('flex');
    search.clearDecorations();
    term.focus();
  }

  return {
    el,
    open: openSearch,
    close,
    isOpen: () => open,
    dispose: () => {
      sub.dispose();
      search.dispose();
      el.remove();
    },
  };
}
