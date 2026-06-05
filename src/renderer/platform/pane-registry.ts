// The terminal ↔ tiling seam (plans/project-structure.md §7). A terminal registers a generic
// handle keyed by TermId; the tiling engine re-parents `el` into grid cells and drives
// focus/fit/dispose — neither feature imports the other's internals beyond this.
import type { TermId } from '@shared/ids';

export interface PaneHandle {
  /** stable element the tiling engine re-parents between cells (never remounted) */
  el: HTMLElement;
  focus(): void;
  fit(): void;
  dispose(): void;
}

const panes = new Map<number, PaneHandle>();

export function registerPane(id: TermId, handle: PaneHandle): void {
  panes.set(id, handle);
}

export function getPane(id: TermId): PaneHandle | undefined {
  return panes.get(id);
}

export function deletePane(id: TermId): void {
  panes.delete(id);
}
