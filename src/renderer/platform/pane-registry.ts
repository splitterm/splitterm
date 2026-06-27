// The terminal ↔ tiling seam (plans/project-structure.md §7). A terminal registers a generic
// handle keyed by TermId; the tiling engine re-parents `el` into grid cells and drives
// focus/fit/dispose — neither feature imports the other's internals beyond this.
import type { TermId } from '@shared/ids';
import type { Settings } from '@shared/domain/settings.schema';

export interface PaneHandle {
  /** stable element the tiling engine re-parents between cells (never remounted) */
  el: HTMLElement;
  /** display title for the pane (e.g. the launch profile name); '' = none */
  title: string;
  /** the profile id this pane was launched with (for session restore); undefined = default shell */
  profileId?: string;
  focus(): void;
  fit(): void;
  /** the latest working directory the shell reported (OSC 7); undefined if never reported */
  cwd(): string | undefined;
  /** re-apply live settings (font / cursor / scrollback + theme) to the terminal */
  applySettings(settings: Settings): void;
  dispose(): void;
}

const panes = new Map<number, PaneHandle>();

export function registerPane(id: TermId, handle: PaneHandle): void {
  panes.set(id, handle);
}

export function getPane(id: TermId): PaneHandle | undefined {
  return panes.get(id);
}

export function allPanes(): PaneHandle[] {
  return [...panes.values()];
}

export function deletePane(id: TermId): void {
  panes.delete(id);
}
