// Broadcast input: when ON, a keystroke (or paste) in the focused pane is mirrored to EVERY pane's
// PTY — iTerm2's "Broadcast input" / tmux's synchronize-panes. Drive several shells (or Claude
// sessions) in lockstep. OFF by default and never persisted; a prominent indicator shows when active,
// since it routes your typing everywhere. This module is just the shared flag + an observer the
// terminal input path and the chrome indicator both read.
//
// Limitation (shared with tmux synchronize-panes): keystrokes are mirrored as the focused pane's
// already-encoded bytes, so a special key (arrows, Home/End) whose encoding depends on terminal mode
// — application-cursor-keys etc. — follows the FOCUSED pane's mode in every pane. Plain typing and
// pastes (re-pasted per-pane to honor each pane's bracketed-paste mode) are unaffected.

let broadcasting = false;
const listeners = new Set<(on: boolean) => void>();

export function isBroadcasting(): boolean {
  return broadcasting;
}

export function setBroadcasting(on: boolean): void {
  if (on === broadcasting) return;
  broadcasting = on;
  for (const cb of listeners) cb(on);
}

export function toggleBroadcasting(): void {
  setBroadcasting(!broadcasting);
}

/** Subscribe to broadcast on/off changes. Returns an unsubscribe function. */
export function onBroadcastChange(cb: (on: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
