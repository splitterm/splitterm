// The terminal ↔ tiling seam (plans/project-structure.md §7). A terminal registers a generic
// handle keyed by TermId; the tiling engine re-parents `el` into grid cells and drives
// focus/fit/dispose — neither feature imports the other's internals beyond this.
import type { TermId } from '@shared/ids';
import type { Settings } from '@shared/domain/settings.schema';

/**
 * A pane's live activity: `claudeWorking` = Claude Code is actively processing a turn (detected from
 * its on-screen "esc to interrupt" hint) — shown prominently in Claude's colour; `working` = generic
 * output is streaming; `attention` = the shell rang the bell and went quiet (a tool signalling it needs
 * you); `idle` = quiet; `exited` = the process ended.
 */
export type PaneStatus = 'claudeWorking' | 'working' | 'attention' | 'idle' | 'exited';

export interface PaneHandle {
  /** stable element the tiling engine re-parents between cells (never remounted) */
  el: HTMLElement;
  /** PERSISTENT title (the launch profile name); '' = none. Saved for session restore. */
  title: string;
  /** the title to SHOW — the profile `title` when set, else the shell's live OSC 0/2 title (chip + sidebar) */
  displayTitle(): string;
  /** the profile id this pane was launched with (for session restore); undefined = default shell */
  profileId?: string;
  focus(): void;
  fit(): void;
  /** write input to this pane's PTY (used by broadcast-input to mirror keystrokes to every pane) */
  write(data: string): void;
  /** paste text into this pane (honors its own bracketed-paste mode) — used by broadcast paste */
  paste(data: string): void;
  /** the latest working directory the shell reported (OSC 7); undefined if never reported */
  cwd(): string | undefined;
  /** re-apply live settings (font / cursor / scrollback + theme) to the terminal */
  applySettings(settings: Settings): void;
  /** serialize the buffer (capped) to a replayable string, for session-restore history; '' if empty */
  serialize(): string;
  /** live activity status (working / attention / idle / exited) — shown in the Sessions sidebar */
  status(): PaneStatus;
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

// The shell can change a pane's title at any time (OSC 0/2). Terminals notify here; the tiling engine
// subscribes to refresh the pane chip + Sessions sidebar live, without a full relayout.
const titleListeners = new Set<(id: TermId) => void>();

/** Subscribe to live pane-title changes. Returns an unsubscribe function. */
export function onPaneTitleChange(cb: (id: TermId) => void): () => void {
  titleListeners.add(cb);
  return () => titleListeners.delete(cb);
}

/** Notify subscribers that pane `id`'s display title changed. */
export function notifyPaneTitleChange(id: TermId): void {
  for (const cb of titleListeners) cb(id);
}

// A pane's activity status changes as its shell produces output / rings the bell / exits. Terminals
// notify here; the tiling engine subscribes to refresh the Sessions sidebar (coalesced, no save).
const statusListeners = new Set<(id: TermId) => void>();

/** Subscribe to live pane-status changes. Returns an unsubscribe function. */
export function onPaneStatusChange(cb: (id: TermId) => void): () => void {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

/** Notify subscribers that pane `id`'s activity status changed. */
export function notifyPaneStatusChange(id: TermId): void {
  for (const cb of statusListeners) cb(id);
}
