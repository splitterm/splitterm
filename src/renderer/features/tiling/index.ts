// BSP tiling engine. Renders the layout tree as nested CSS Grid and re-parents STABLE xterm
// elements between cells (never remounts — preserves scrollback/state). Drag-resize adjusts
// `fr` ratios live; per-pane ResizeObserver refits. See architecture.md §5, project-structure.md §7.
import { createTerminal } from '@features/terminal';
import { getPane } from '@platform/pane-registry';
import {
  type LayoutNode,
  type LeafNode,
  type SplitNode,
  type Dir,
  leaf,
  collectLeaves,
  findLeaf,
  splitLeaf,
  closeLeaf,
} from '@shared/domain/layout-tree';

const GUTTER = 6; // px — track width; thin divider that highlights on hover
const FOCUS_RING = 'shadow-[inset_0_0_0_1px_var(--accent)]';
const MIN_RATIO = 0.05;

export interface Tiling {
  dispose(): void;
}

export async function createTiling(container: HTMLElement): Promise<Tiling> {
  let root: LayoutNode | null = null;
  let focusedLeafId: string | null = null;
  let maximizedId: string | null = null;
  let leafSeq = 0;
  let dragging = false;

  async function makeLeaf(): Promise<LeafNode> {
    const { termId } = await createTerminal();
    return leaf(`leaf-${++leafSeq}`, termId);
  }

  // ---- rendering ----------------------------------------------------------

  function applyTemplate(grid: HTMLElement, node: SplitNode): void {
    const tracks: string[] = [];
    node.children.forEach((_, i) => {
      tracks.push(`${node.ratios[i] ?? 1 / node.children.length}fr`);
      if (i < node.children.length - 1) tracks.push(`${GUTTER}px`);
    });
    const value = tracks.join(' ');
    if (node.dir === 'row') {
      grid.style.gridTemplateColumns = value;
      grid.style.gridTemplateRows = '';
    } else {
      grid.style.gridTemplateRows = value;
      grid.style.gridTemplateColumns = '';
    }
  }

  function buildLeaf(node: LeafNode): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'relative min-w-0 min-h-0 overflow-hidden';
    cell.dataset.leafId = node.id;
    if (node.id === focusedLeafId) cell.classList.add(FOCUS_RING);
    const pane = getPane(node.termId);
    if (pane) cell.appendChild(pane.el);
    cell.addEventListener(
      'mousedown',
      () => focusLeaf(node.id),
      { capture: true }, // focus the tile, but let the event reach xterm for cursor/selection
    );
    return cell;
  }

  function buildSplit(node: SplitNode): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'grid h-full w-full min-w-0 min-h-0';
    applyTemplate(grid, node);
    node.children.forEach((child, i) => {
      grid.appendChild(buildNode(child));
      if (i < node.children.length - 1) grid.appendChild(makeGutter(node, i, grid));
    });
    return grid;
  }

  function buildNode(node: LayoutNode): HTMLElement {
    return node.type === 'leaf' ? buildLeaf(node) : buildSplit(node);
  }

  function makeGutter(node: SplitNode, i: number, grid: HTMLElement): HTMLElement {
    const g = document.createElement('div');
    g.className =
      `min-w-0 min-h-0 bg-[var(--border)] hover:bg-[var(--accent)] ` +
      `transition-colors duration-[var(--motion-fast)] ` +
      (node.dir === 'row' ? 'cursor-col-resize' : 'cursor-row-resize');
    g.addEventListener('mousedown', (e) => startDrag(e, node, i, grid));
    return g;
  }

  function startDrag(e: MouseEvent, node: SplitNode, i: number, grid: HTMLElement): void {
    e.preventDefault();
    dragging = true;
    const horizontal = node.dir === 'row';
    const rect = grid.getBoundingClientRect();
    const total = horizontal ? rect.width : rect.height;
    if (total <= 0) return;
    const startPos = horizontal ? e.clientX : e.clientY;
    const a0 = node.ratios[i] ?? 0.5;
    const b0 = node.ratios[i + 1] ?? 0.5;
    const sum = a0 + b0;

    const onMove = (ev: MouseEvent): void => {
      const pos = horizontal ? ev.clientX : ev.clientY;
      const delta = (pos - startPos) / total;
      const a = Math.max(MIN_RATIO, Math.min(sum - MIN_RATIO, a0 + delta));
      node.ratios[i] = a;
      node.ratios[i + 1] = sum - a;
      applyTemplate(grid, node); // cheap style write; per-pane ResizeObserver refits + resizes pty
    };
    const onUp = (): void => {
      dragging = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function render(): void {
    if (!root) {
      container.replaceChildren();
      return;
    }
    if (maximizedId) {
      const node = findLeaf(root, maximizedId);
      if (node) {
        container.replaceChildren(buildLeaf(node));
        refitAll();
        return;
      }
      maximizedId = null;
    }
    container.replaceChildren(buildNode(root));
    refitAll();
  }

  function refitAll(): void {
    requestAnimationFrame(() => {
      if (!root) return;
      for (const lf of collectLeaves(root)) getPane(lf.termId)?.fit();
    });
  }

  // ---- operations ---------------------------------------------------------

  function focusLeaf(id: string): void {
    focusedLeafId = id;
    container.querySelectorAll<HTMLElement>('[data-leaf-id]').forEach((el) => {
      el.classList.toggle(FOCUS_RING, el.dataset.leafId === id);
    });
    const node = root ? findLeaf(root, id) : null;
    if (node) getPane(node.termId)?.focus();
  }

  async function splitActive(dir: Dir): Promise<void> {
    const activeId = focusedLeafId;
    if (!root || !activeId) return;
    maximizedId = null;
    const node = await makeLeaf();
    // The focused leaf could have been closed while we awaited the new terminal — if so,
    // discard the freshly-spawned terminal rather than inserting an orphan leaf.
    if (!root || !findLeaf(root, activeId)) {
      getPane(node.termId)?.dispose();
      return;
    }
    root = splitLeaf(root, activeId, dir, node);
    focusedLeafId = node.id;
    render();
    focusLeaf(node.id);
  }

  function closeActive(): void {
    const activeId = focusedLeafId;
    if (!root || !activeId) return;
    const target = findLeaf(root, activeId);
    if (!target) return;
    root = closeLeaf(root, activeId);
    getPane(target.termId)?.dispose();
    if (maximizedId === activeId) maximizedId = null;

    if (!root) {
      void initFirst(); // never leave the user with no terminal
      return;
    }
    focusedLeafId = collectLeaves(root)[0]?.id ?? null;
    render();
    if (focusedLeafId) focusLeaf(focusedLeafId);
  }

  function toggleZoom(): void {
    if (!focusedLeafId) return;
    maximizedId = maximizedId ? null : focusedLeafId;
    render();
    if (focusedLeafId) focusLeaf(focusedLeafId);
  }

  type FocusDir = 'left' | 'right' | 'up' | 'down';
  function focusDir(dir: FocusDir): void {
    const activeId = focusedLeafId;
    if (!root || !activeId) return;
    const rects = new Map<string, DOMRect>();
    container.querySelectorAll<HTMLElement>('[data-leaf-id]').forEach((el) => {
      if (el.dataset.leafId) rects.set(el.dataset.leafId, el.getBoundingClientRect());
    });
    const cur = rects.get(activeId);
    if (!cur) return;
    const cx = cur.left + cur.width / 2;
    const cy = cur.top + cur.height / 2;

    let best: { id: string; dist: number } | null = null;
    for (const [id, r] of rects) {
      if (id === activeId) continue;
      const dx = r.left + r.width / 2 - cx;
      const dy = r.top + r.height / 2 - cy;
      const inDir =
        (dir === 'left' && dx < -1) ||
        (dir === 'right' && dx > 1) ||
        (dir === 'up' && dy < -1) ||
        (dir === 'down' && dy > 1);
      if (!inDir) continue;
      const horizontal = dir === 'left' || dir === 'right';
      const dist = (horizontal ? Math.abs(dx) : Math.abs(dy)) + (horizontal ? Math.abs(dy) : Math.abs(dx)) * 2;
      if (!best || dist < best.dist) best = { id, dist };
    }
    if (best) focusLeaf(best.id);
  }

  // ---- keybindings (M2 defaults; settings-driven in M3) -------------------

  // Chords chosen to avoid common shell bindings (Ctrl+C/D/Z/R/S etc.). They're intercepted in the
  // capture phase so they never reach xterm/the PTY; everything else passes straight through.
  // M3 makes these settings-driven.
  function onKeydown(e: KeyboardEvent): void {
    if (e.repeat || dragging) return; // ignore auto-repeat and keys during a gutter drag
    // Split: Alt+Shift+'=' → right (row), Alt+Shift+'-' → down (col)
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      if (e.code === 'Equal') return intercept(e, () => void splitActive('row'));
      if (e.code === 'Minus') return intercept(e, () => void splitActive('col'));
    }
    // Close: Ctrl+Shift+W
    if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyW') {
      return intercept(e, closeActive);
    }
    // Zoom toggle: Ctrl+Shift+Enter
    if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'Enter') {
      return intercept(e, toggleZoom);
    }
    // Directional focus: Alt+Arrow — only steal the key when there's more than one pane,
    // so single-pane Alt+Arrow still reaches the shell (word nav).
    if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const dir = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' } as const)[
        e.code as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'
      ];
      if (dir && root && collectLeaves(root).length > 1) {
        return intercept(e, () => focusDir(dir));
      }
    }
  }

  function intercept(e: KeyboardEvent, run: () => void): void {
    e.preventDefault();
    e.stopPropagation(); // capture-phase stop keeps the chord from reaching xterm/the PTY
    run();
  }

  // ---- lifecycle ----------------------------------------------------------

  async function initFirst(): Promise<void> {
    const node = await makeLeaf();
    root = node;
    focusedLeafId = node.id;
    maximizedId = null;
    render();
    focusLeaf(node.id);
  }

  window.addEventListener('keydown', onKeydown, { capture: true });
  await initFirst();

  return {
    dispose() {
      window.removeEventListener('keydown', onKeydown, { capture: true });
      if (root) for (const lf of collectLeaves(root)) getPane(lf.termId)?.dispose();
      container.replaceChildren();
    },
  };
}
