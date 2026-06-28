// BSP tiling engine. Renders the layout tree as nested CSS Grid and re-parents STABLE xterm
// elements between cells (never remounts — preserves scrollback/state). Drag-resize adjusts
// `fr` ratios live; per-pane ResizeObserver refits. See architecture.md §5, project-structure.md §7.
import { X, GripVertical, Terminal as TerminalIcon } from 'lucide';
import { createTerminal } from '@features/terminal';
import { getPane, onPaneTitleChange } from '@platform/pane-registry';
import { getSettings } from '@platform/settings-controller';
import type { TermId } from '@shared/ids';
import { icon } from '../../chrome/icons';
import {
  type LayoutNode,
  type LeafNode,
  type SplitNode,
  type Dir,
  type SessionV1,
  leaf,
  collectLeaves,
  findLeaf,
  splitLeaf,
  closeLeaf,
  moveLeaf,
} from '@shared/domain/layout-tree';
import { pickZone, zoneToSplit, type Zone } from './drop-zone';
import { chordFromEvent, matchAction } from '@shared/domain/keymap';

const GUTTER = 6; // px — transparent gap between cards; highlights on hover for resize
const FOCUS_RING = 'pane-focused'; // styled in base.css (accent border on the focused card)
const MIN_RATIO = 0.05;

/** A snapshot row for the Sessions sidebar: one open terminal, in creation order. */
export interface PaneInfo {
  leafId: string;
  termId: number;
  title: string;
  focused: boolean;
}

/**
 * Why the open-terminals list changed. 'structural' = a pane was added/removed/moved/focused (the
 * layout changed → persist it). 'title' = only a pane's live display title changed (cosmetic — the
 * sidebar should refresh, but it must NOT trigger a session save, since the title isn't persisted).
 */
export type ChangeReason = 'structural' | 'title';

export interface Tiling {
  /** Add a terminal by splitting the largest pane (even tiling). */
  addTerminal(profileId?: string, title?: string): Promise<void>;
  /** Close the most-recently-created terminal (keeps at least one). */
  removeLast(): void;
  /** Focus a specific pane (e.g. from the Sessions sidebar). */
  focusPane(leafId: string): void;
  /** Close a specific pane (e.g. from the Sessions sidebar). */
  closePane(leafId: string): void;
  /** Subscribe to the open-terminals list; fires immediately with the current snapshot. */
  onChange(cb: (panes: PaneInfo[], reason: ChangeReason) => void): () => void;
  /** Snapshot the layout (tree + per-pane cwd/profile/title) for persistence. */
  serialize(): SessionV1;
  /** Rebuild a saved layout, spawning a fresh terminal per leaf. No-op unless currently empty. */
  restore(session: SessionV1): Promise<void>;
  dispose(): void;
}

export async function createTiling(container: HTMLElement): Promise<Tiling> {
  let root: LayoutNode | null = null;
  let focusedLeafId: string | null = null;
  let maximizedId: string | null = null;
  let leafSeq = 0;
  let dragging = false;
  let lastAdd = 0;
  let lastRemove = 0;
  const order: string[] = []; // leaf ids in creation order (existing leaves only)
  const listeners: Array<(panes: PaneInfo[], reason: ChangeReason) => void> = [];

  // The open-terminals snapshot (creation order), for the Sessions sidebar.
  function snapshot(): PaneInfo[] {
    if (!root) return [];
    const out: PaneInfo[] = [];
    for (const id of order) {
      const lf = findLeaf(root, id);
      if (!lf) continue;
      out.push({ leafId: id, termId: lf.termId, title: getPane(lf.termId)?.displayTitle() ?? '', focused: id === focusedLeafId });
    }
    return out;
  }
  function emit(reason: ChangeReason = 'structural'): void {
    const s = snapshot();
    for (const l of listeners) l(s, reason);
  }

  // Honor BOTH the OS preference and the in-app "Reduce motion" toggle (settings-controller sets
  // <html data-reduce-motion>). Without the attribute check, the split/close View Transition would
  // keep its UA cross-fade even with the in-app toggle on (which only zeroes the CSS motion tokens).
  const prefersReducedMotion = (): boolean =>
    document.documentElement.dataset.reduceMotion === 'true' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Apply a layout change with a smooth View Transition (Chromium 148) when motion is allowed.
  function applyLayout(mutate: () => void): void {
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { finished?: Promise<unknown> };
    };
    if (typeof doc.startViewTransition === 'function' && !prefersReducedMotion()) {
      const transition = doc.startViewTransition(() => mutate());
      // Captured panes are restored to normal layout only after the transition finishes — refit
      // then so any freshly-attached terminal gets its final size (and never stays blank).
      void transition.finished?.then(() => refitAll());
    } else {
      mutate();
    }
  }

  // Re-render with a transition, then move xterm focus to the active pane (after the DOM updates).
  function relayout(focusId?: string): void {
    if (focusId) focusedLeafId = focusId;
    applyLayout(() => {
      render();
      const node = focusedLeafId && root ? findLeaf(root, focusedLeafId) : null;
      if (node) getPane(node.termId)?.focus();
    });
  }

  async function makeLeaf(profileId?: string, title?: string, cwd?: string): Promise<LeafNode> {
    const { termId } = await createTerminal(profileId, title, cwd);
    const node = leaf(`leaf-${++leafSeq}`, termId);
    order.push(node.id);
    return node;
  }

  // Discard a just-created leaf that won't be placed (kills its pty, untracks it).
  function dropLeaf(node: LeafNode): void {
    const oi = order.indexOf(node.id);
    if (oi >= 0) order.splice(oi, 1);
    getPane(node.termId)?.dispose();
  }

  /** Split direction that keeps a pane roughly square: split its longer axis. */
  function autoSplitDirFor(leafId: string): Dir {
    const cell = container.querySelector<HTMLElement>(`[data-leaf-id="${CSS.escape(leafId)}"]`);
    if (cell) {
      const r = cell.getBoundingClientRect();
      return r.width >= r.height ? 'row' : 'col';
    }
    return 'row';
  }

  /** The largest visible leaf — splitting it (not the focused one) keeps panes even. */
  function largestLeafId(): string | null {
    let bestId: string | null = null;
    let bestArea = -1;
    container.querySelectorAll<HTMLElement>('[data-leaf-id]').forEach((el) => {
      const id = el.dataset.leafId;
      if (!id) return;
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) {
        bestArea = area;
        bestId = id;
      }
    });
    return bestId;
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
    // h-full/w-full so a single leaf (direct child of the container) and the maximized leaf fill
    // it — the xterm inside is absolutely positioned, so without this the cell collapses to 0 height.
    cell.className = 'group relative h-full w-full min-w-0 min-h-0 overflow-hidden';
    cell.dataset.leafId = node.id;
    cell.dataset.termId = String(node.termId);
    // Name the transition group by TERMINAL so swaps/splits animate the terminal moving to its new
    // position (rather than a crossfade in place).
    cell.style.setProperty('view-transition-name', `term-${node.termId}`);
    if (node.id === focusedLeafId) cell.classList.add(FOCUS_RING);
    const pane = getPane(node.termId);
    if (pane) cell.appendChild(pane.el);
    const dt = pane?.displayTitle() ?? '';
    if (dt) cell.appendChild(makeTitleChip(dt));
    cell.addEventListener(
      'mousedown',
      () => focusLeaf(node.id),
      { capture: true }, // focus the tile, but let the event reach xterm for cursor/selection
    );
    cell.appendChild(makeDragHandle(node.id));
    cell.appendChild(makeCloseButton(node.id));
    return cell;
  }

  function makeTitleChip(title: string): HTMLElement {
    const el = document.createElement('div');
    el.className =
      'pane-title pointer-events-none absolute top-1 left-1/2 -translate-x-1/2 z-10 max-w-[60%] truncate ' +
      'px-2 h-5 inline-flex items-center rounded-[var(--r-sm)] border border-[var(--border)] ' +
      'bg-[var(--bg-surface)] text-[11px] text-[var(--text-secondary)] select-none';
    el.textContent = title;
    return el;
  }

  function makeDragHandle(leafId: string): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Drag to move';
    btn.setAttribute('aria-label', 'Move pane');
    btn.className =
      'app-no-drag absolute top-1 left-1 z-10 inline-flex items-center justify-center w-5 h-5 ' +
      'rounded-[var(--r-sm)] cursor-grab opacity-0 group-hover:opacity-100 ' +
      'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] ' +
      'transition-opacity ease-[var(--ease-out)] duration-[var(--motion-fast)]';
    btn.appendChild(icon(GripVertical, 13));
    btn.addEventListener('pointerdown', (e) => startPaneDrag(leafId, e));
    return btn;
  }

  function makeCloseButton(leafId: string): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Close pane';
    btn.setAttribute('aria-label', 'Close pane');
    btn.className =
      'app-no-drag absolute top-1 right-1 z-10 inline-flex items-center justify-center w-5 h-5 ' +
      'rounded-[var(--r-sm)] cursor-pointer opacity-0 group-hover:opacity-100 ' +
      'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] ' +
      'transition-opacity ease-[var(--ease-out)] duration-[var(--motion-fast)]';
    btn.appendChild(icon(X, 13));
    btn.addEventListener('mousedown', (e) => e.stopPropagation()); // don't trigger focus/drag
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeById(leafId);
    });
    return btn;
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
      `min-w-0 min-h-0 rounded-full hover:bg-[var(--accent)] ` +
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
      container.replaceChildren(emptyState());
      emit();
      return;
    }
    if (maximizedId) {
      const node = findLeaf(root, maximizedId);
      if (node) {
        container.replaceChildren(buildLeaf(node));
        refitAll();
        emit();
        return;
      }
      maximizedId = null;
    }
    container.replaceChildren(buildNode(root));
    refitAll();
    emit();
  }

  function refitAll(): void {
    requestAnimationFrame(() => {
      if (!root) return;
      for (const lf of collectLeaves(root)) getPane(lf.termId)?.fit();
    });
  }

  function emptyState(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'absolute inset-0 flex flex-col items-center justify-center gap-1 select-none';
    const title = document.createElement('div');
    title.className = 'text-[13px] text-[var(--text-secondary)]';
    title.textContent = 'No terminal open';
    const hint = document.createElement('div');
    hint.className = 'text-[11px] text-[var(--text-disabled)]';
    hint.textContent = 'Press + to open a terminal';
    wrap.append(title, hint);
    return wrap;
  }

  // ---- operations ---------------------------------------------------------

  function focusLeaf(id: string): void {
    focusedLeafId = id;
    container.querySelectorAll<HTMLElement>('[data-leaf-id]').forEach((el) => {
      el.classList.toggle(FOCUS_RING, el.dataset.leafId === id);
    });
    const node = root ? findLeaf(root, id) : null;
    if (node) getPane(node.termId)?.focus();
    emit(); // focus changed — refresh the Sessions highlight
  }

  async function doSplit(targetId: string, dir: Dir, profileId?: string, title?: string, cwd?: string): Promise<void> {
    if (!root) return;
    maximizedId = null;
    const node = await makeLeaf(profileId, title, cwd);
    // The target could have been closed while we awaited the spawn — drop the orphan if so.
    if (!root || !findLeaf(root, targetId)) {
      dropLeaf(node);
      return;
    }
    root = splitLeaf(root, targetId, dir, node);
    relayout(node.id);
  }

  // The first terminal (empty → one pane). Rendered DIRECTLY (no View Transition): a brand-new
  // xterm must size on attach, and wrapping that first render in a transition leaves it blank
  // until a later re-render. Drops itself if another add won the race.
  async function createFirst(profileId?: string, title?: string): Promise<void> {
    const node = await makeLeaf(profileId, title);
    if (root) {
      dropLeaf(node);
      return;
    }
    root = node;
    focusedLeafId = node.id;
    render();
    focusLeaf(node.id);
  }

  // Keyboard split: split the FOCUSED pane (or open the first terminal when empty). The new pane
  // duplicates the focused pane's launch context — same profile (re-running its startup command),
  // same title, and same cwd (from its OSC 7 reports) — so splitting a "Claude" pane gives another.
  function splitActive(dir: Dir): void {
    if (!root) {
      void addTerminal();
      return;
    }
    if (!focusedLeafId) return;
    const lf = findLeaf(root, focusedLeafId);
    const pane = lf ? getPane(lf.termId) : undefined;
    void doSplit(focusedLeafId, dir, pane?.profileId, pane?.title || undefined, pane?.cwd());
  }

  // Button "+": open exactly one terminal. When empty, create the first; otherwise add evenly by
  // splitting the LARGEST pane along its longer axis (half/half, then stacked, then a grid). The
  // time guard collapses the duplicate click a frameless titlebar fires on first interaction.
  async function addTerminal(profileId?: string, title?: string): Promise<void> {
    const now = performance.now();
    if (now - lastAdd < 350) return;
    lastAdd = now;
    if (!root) {
      await createFirst(profileId, title);
      return;
    }
    const targetId = largestLeafId() ?? focusedLeafId;
    if (!targetId) return;
    await doSplit(targetId, autoSplitDirFor(targetId), profileId, title);
  }

  function closeById(leafId: string): void {
    if (!root) return;
    const target = findLeaf(root, leafId);
    if (!target) return;
    const oi = order.indexOf(leafId);
    if (oi >= 0) order.splice(oi, 1);
    const termId = target.termId;
    root = closeLeaf(root, leafId);
    getPane(termId)?.dispose();
    if (maximizedId === leafId) maximizedId = null;

    if (!root) {
      focusedLeafId = null;
      applyLayout(render); // back to the empty state (animated)
      return;
    }
    if (!focusedLeafId || focusedLeafId === leafId || !findLeaf(root, focusedLeafId)) {
      focusedLeafId = collectLeaves(root)[0]?.id ?? null;
    }
    relayout();
  }

  function closeActive(): void {
    if (focusedLeafId) closeById(focusedLeafId);
  }

  // Swap the terminals at two leaves (the tree structure stays; only the contents trade places).
  function swap(aId: string, bId: string): void {
    if (!root || aId === bId) return;
    const a = findLeaf(root, aId);
    const b = findLeaf(root, bId);
    if (!a || !b) return;
    const tmp = a.termId;
    a.termId = b.termId;
    b.termId = tmp;
    relayout(bId); // focus follows the dragged terminal to its new home
  }

  // Re-tile: move the dragged pane to an edge of the target (zone → direction + leading/trailing
  // side). The pane keeps its live terminal — no respawn — so scrollback survives the move.
  function moveLeafTo(sourceId: string, targetId: string, dir: Dir, before: boolean): void {
    if (!root) return;
    const next = moveLeaf(root, sourceId, targetId, dir, before);
    if (next === root) return; // the move changed nothing
    maximizedId = null;
    root = next;
    relayout(sourceId); // focus follows the pane the user just moved
  }

  // Pointer-drag a pane via its grip handle: a ghost follows the cursor, the source pane dims, and a
  // zone overlay previews where it will land. Dropping on a pane's center swaps the two; dropping on
  // an edge re-tiles the dragged pane to that side (Windows-Snap style).
  function startPaneDrag(sourceId: string, e: PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (!root || collectLeaves(root).length < 2) return;

    let targetId: string | null = null;
    let targetZone: Zone | null = null;
    const cellFor = (id: string): HTMLElement | null =>
      container.querySelector<HTMLElement>(`[data-leaf-id="${CSS.escape(id)}"]`);

    const sourceCell = cellFor(sourceId);
    sourceCell?.classList.add('pane-source'); // lift/dim the pane being moved

    // Cursor-following ghost. pointer-events:none so it never blocks the drop hit-test; positioned
    // with transform so the follow stays on the compositor (smooth/responsive).
    const ghost = document.createElement('div');
    ghost.className =
      'pane-ghost fixed left-0 top-0 z-[100] pointer-events-none flex items-center gap-2 h-9 px-3 ' +
      'rounded-[var(--r-md)] border border-[var(--accent)] bg-[var(--bg-elevated)] text-[12px] ' +
      'text-[var(--text-primary)] shadow-[0_8px_24px_rgba(0,0,0,0.45)] opacity-95 will-change-transform';
    ghost.appendChild(icon(TerminalIcon, 14));
    const label = document.createElement('span');
    label.textContent = 'Terminal';
    ghost.appendChild(label);
    document.body.appendChild(ghost);
    const moveGhost = (x: number, y: number): void => {
      ghost.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
    };
    moveGhost(e.clientX, e.clientY);

    // Floating overlay that fills the half (or whole, for a swap) of the target pane the drop will
    // occupy. pointer-events:none so it never interferes with the hit-test under the cursor.
    const zoneEl = document.createElement('div');
    zoneEl.className = 'pane-drop-zone fixed left-0 top-0 z-[90] pointer-events-none';
    zoneEl.style.display = 'none';
    document.body.appendChild(zoneEl);
    const positionZone = (cell: HTMLElement, zone: Zone): void => {
      const r = cell.getBoundingClientRect();
      let x = r.left;
      let y = r.top;
      let w = r.width;
      let h = r.height;
      if (zone === 'left') {
        w = r.width / 2;
      } else if (zone === 'right') {
        x = r.left + r.width / 2;
        w = r.width / 2;
      } else if (zone === 'top') {
        h = r.height / 2;
      } else if (zone === 'bottom') {
        y = r.top + r.height / 2;
        h = r.height / 2;
      }
      // center → the whole rect (a swap)
      zoneEl.style.transform = `translate(${x}px, ${y}px)`;
      zoneEl.style.width = `${w}px`;
      zoneEl.style.height = `${h}px`;
      zoneEl.classList.toggle('is-swap', zone === 'center');
      zoneEl.style.display = 'block';
    };

    const clearTarget = (): void => {
      if (targetId) cellFor(targetId)?.classList.remove('drop-target');
      targetId = null;
      targetZone = null;
      zoneEl.style.display = 'none';
    };
    const setTarget = (cell: HTMLElement | null, x: number, y: number): void => {
      const id = cell?.dataset.leafId ?? null;
      if (!cell || !id || id === sourceId) {
        clearTarget();
        return;
      }
      const r = cell.getBoundingClientRect();
      const zone = pickZone((x - r.left) / r.width, (y - r.top) / r.height);
      if (id === targetId && zone === targetZone) return; // unchanged — skip the DOM writes
      if (targetId && targetId !== id) cellFor(targetId)?.classList.remove('drop-target');
      targetId = id;
      targetZone = zone;
      cell.classList.add('drop-target');
      positionZone(cell, zone);
    };
    const onMove = (ev: PointerEvent): void => {
      moveGhost(ev.clientX, ev.clientY);
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const cell = under instanceof Element ? under.closest<HTMLElement>('[data-leaf-id]') : null;
      setTarget(cell, ev.clientX, ev.clientY);
    };
    // Single teardown for every end-of-drag path. `commit` is true only for a real drop (pointerup);
    // a canceled pointer stream (pointercancel) tears everything down WITHOUT performing the move.
    const finishDrag = (commit: boolean): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      dragging = false;
      document.body.classList.remove('pane-dragging');
      ghost.remove();
      zoneEl.remove();
      sourceCell?.classList.remove('pane-source');
      const dest = targetId;
      const zone = targetZone;
      if (dest) cellFor(dest)?.classList.remove('drop-target');
      if (!commit || !dest || !zone) return;
      const split = zoneToSplit(zone);
      if (split) moveLeafTo(sourceId, dest, split.dir, split.before);
      else swap(sourceId, dest); // center zone → swap
    };
    const onUp = (): void => finishDrag(true);
    const onCancel = (): void => finishDrag(false);
    // Suppress layout keyboard chords for the duration of the drag (mirrors the gutter resize), so a
    // split/close/zoom/focus key can't rebuild the cells out from under the active drag.
    dragging = true;
    document.body.classList.add('pane-dragging');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  // Button "−": close the most-recently-created terminal that still exists (down to empty).
  // Time-guarded like the add button so a duplicate first-click can't remove two.
  function removeLast(): void {
    const now = performance.now();
    if (now - lastRemove < 350) return;
    lastRemove = now;
    if (!root) return;
    for (let i = order.length - 1; i >= 0; i--) {
      const id = order[i];
      if (id && findLeaf(root, id)) {
        closeById(id);
        return;
      }
    }
  }

  function toggleZoom(): void {
    if (!focusedLeafId) return;
    maximizedId = maximizedId ? null : focusedLeafId;
    relayout();
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

  // Tiling shortcuts are user-rebindable (Settings → Keyboard). We resolve the pressed chord to an
  // action via the live keybindings, then run it — intercepting in the capture phase so the chord
  // never reaches xterm/the PTY; everything unbound passes straight through.
  function onKeydown(e: KeyboardEvent): void {
    if (e.repeat || dragging) return; // ignore auto-repeat and keys during a gutter drag
    // Ignore keys while the settings modal owns focus (this is a window capture-phase listener, so it
    // would otherwise fire BEFORE the Keyboard section's chord-capture button and run the bound action
    // — e.g. close a pane — behind the modal, while also stealing the keypress from the rebind UI).
    const t = e.target;
    if (t instanceof Element && t.closest('.settings-overlay')) return;
    const chord = chordFromEvent(e);
    if (!chord) return;
    const action = matchAction(chord, getSettings().keybindings);
    if (!action) return;
    switch (action) {
      case 'splitRight':
        return intercept(e, () => void splitActive('row'));
      case 'splitDown':
        return intercept(e, () => void splitActive('col'));
      case 'closePane':
        return intercept(e, closeActive);
      case 'toggleZoom':
        return intercept(e, toggleZoom);
      case 'focusLeft':
      case 'focusRight':
      case 'focusUp':
      case 'focusDown': {
        // Directional focus only steals the key when there's more than one pane, so a single-pane
        // binding (e.g. the default Alt+Arrow) still reaches the shell for word navigation.
        if (!root || collectLeaves(root).length <= 1) return;
        const dir = ({ focusLeft: 'left', focusRight: 'right', focusUp: 'up', focusDown: 'down' } as const)[action];
        return intercept(e, () => focusDir(dir));
      }
    }
  }

  function intercept(e: KeyboardEvent, run: () => void): void {
    e.preventDefault();
    e.stopPropagation(); // capture-phase stop keeps the chord from reaching xterm/the PTY
    run();
  }

  // ---- session restore ----------------------------------------------------

  function serialize(): SessionV1 {
    const captureScrollback = getSettings().restoreScrollback; // opt-in: persists terminal output
    const leaves: SessionV1['leaves'] = {};
    if (root) {
      for (const lf of collectLeaves(root)) {
        const pane = getPane(lf.termId);
        const entry: SessionV1['leaves'][string] = {};
        const cwd = pane?.cwd();
        if (cwd) entry.cwd = cwd;
        if (pane?.profileId) entry.profileId = pane.profileId;
        if (pane?.title) entry.title = pane.title;
        if (captureScrollback) {
          const sb = pane?.serialize();
          if (sb) entry.scrollback = sb;
        }
        leaves[lf.id] = entry;
      }
    }
    return { v: 1, root, focusedLeafId, maximizedId, leaves };
  }

  async function restore(session: SessionV1): Promise<void> {
    if (root || !session.root) return; // only restore into an empty tiling
    // Rebuild the saved structure, spawning one fresh terminal per leaf (saved profile + cwd), keeping
    // the saved leaf ids so the saved focused/maximized references stay valid. Track what we spawn so
    // a mid-build spawn failure — or the user opening a terminal during the async window — can be
    // cleaned up instead of leaking a pty or clobbering the user's pane.
    // Spawn every saved leaf CONCURRENTLY (their spawn round-trips + xterm constructions overlap)
    // rather than one-at-a-time, then assemble the tree from the resolved terminals. Track each
    // terminal as it resolves so a mid-build spawn failure — or the user opening a terminal during the
    // async window — can dispose them instead of leaking a pty.
    const sessionLeaves = collectLeaves(session.root); // document order = stable creation order
    const created: Array<{ id: string; termId: LeafNode['termId'] }> = [];
    const discard = (): void => {
      for (const c of created) {
        const oi = order.indexOf(c.id);
        if (oi >= 0) order.splice(oi, 1);
        getPane(c.termId)?.dispose();
      }
    };

    // allSettled, not all: if one spawn rejects, its siblings are still in flight. We must let them
    // ALL settle so created[] is complete before discard() runs — otherwise a late-resolving spawn
    // would register a live pty AFTER cleanup and leak it. (Today the spawn path resolves even on host
    // failure — it returns hostDown rather than throwing — but restore's cleanup must not depend on that.)
    const settled = await Promise.allSettled(
      sessionLeaves.map(async (ln) => {
        const meta = session.leaves[ln.id] ?? {};
        // restore → profile's restore sequence; replay saved scrollback as read-only history
        const { termId } = await createTerminal(meta.profileId, meta.title ?? '', meta.cwd, true, meta.scrollback);
        created.push({ id: ln.id, termId }); // track the moment it exists, for cleanup
      }),
    );
    if (settled.some((s) => s.status === 'rejected')) {
      discard(); // a spawn failed — drop whatever was created, leave the tiling empty
      return;
    }
    if (root) {
      discard(); // the user opened a terminal while we were spawning — let theirs win, drop ours
      return;
    }

    // Commit: record creation order + keep future leaf ids from colliding, then build the tree from
    // the resolved term ids (the saved structure is reused verbatim — same leaf ids, ratios, dirs).
    const termById = new Map(created.map((c) => [c.id, c.termId]));
    for (const ln of sessionLeaves) {
      order.push(ln.id);
      const n = parseInt(ln.id.replace(/^leaf-/, ''), 10);
      if (Number.isFinite(n) && n > leafSeq) leafSeq = n;
    }
    const assemble = (node: LayoutNode): LayoutNode =>
      node.type === 'leaf'
        ? { type: 'leaf', id: node.id, termId: termById.get(node.id)! }
        : { type: 'split', dir: node.dir, children: node.children.map(assemble), ratios: node.ratios };
    const built = assemble(session.root);

    root = built;
    maximizedId = session.maximizedId && findLeaf(built, session.maximizedId) ? session.maximizedId : null;
    // Only the maximized pane is mounted, so focus it; otherwise the saved focus (or the first leaf).
    focusedLeafId =
      maximizedId ??
      (session.focusedLeafId && findLeaf(built, session.focusedLeafId)
        ? session.focusedLeafId
        : (collectLeaves(built)[0]?.id ?? null));
    render();
    if (focusedLeafId) focusLeaf(focusedLeafId);
  }

  // Update a pane's title chip in place when its shell changes the title (OSC 0/2) — no relayout.
  // Find the mounted cell by term id, then create / update / remove the chip to match displayTitle().
  function updateTitleChip(termId: TermId): void {
    const cell = container.querySelector<HTMLElement>(`[data-term-id="${CSS.escape(String(termId))}"]`);
    if (!cell) return; // not currently mounted (e.g. a background pane while another is maximized)
    const dt = getPane(termId)?.displayTitle() ?? '';
    const existing = cell.querySelector('.pane-title');
    if (!dt) existing?.remove();
    else if (existing) existing.textContent = dt;
    else cell.appendChild(makeTitleChip(dt));
  }

  // ---- lifecycle ----------------------------------------------------------

  window.addEventListener('keydown', onKeydown, { capture: true });
  // Refresh the chip (immediately) + Sessions sidebar (coalesced to one frame, so a title-spamming
  // shell can't thrash the sidebar rebuild) when a pane's shell reports a new title. The 'title'
  // reason keeps this off the persistence path — the live title isn't saved.
  let titleRaf = 0;
  const unsubscribeTitles = onPaneTitleChange((id) => {
    updateTitleChip(id);
    if (titleRaf) return;
    titleRaf = requestAnimationFrame(() => {
      titleRaf = 0;
      emit('title');
    });
  });
  render(); // start empty — the first terminal opens on the first "+" (or Alt+Shift+= / -)

  return {
    addTerminal,
    removeLast,
    focusPane(leafId) {
      if (root && findLeaf(root, leafId)) focusLeaf(leafId);
    },
    closePane(leafId) {
      closeById(leafId);
    },
    onChange(cb) {
      listeners.push(cb);
      cb(snapshot(), 'structural');
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    serialize,
    restore,
    dispose() {
      window.removeEventListener('keydown', onKeydown, { capture: true });
      unsubscribeTitles();
      if (titleRaf) cancelAnimationFrame(titleRaf);
      if (root) for (const lf of collectLeaves(root)) getPane(lf.termId)?.dispose();
      container.replaceChildren();
    },
  };
}
