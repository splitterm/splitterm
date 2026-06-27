import { app } from 'electron';
import { promises as fs, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { EMPTY_SESSION, normalizeSession, type SessionV1 } from '@shared/domain/layout-tree';

// Persists the window layout (tree + per-pane cwd/profile) to userData/session.json so the previous
// session reopens on launch. Renderer-owned UI state, but routed through main (like settings) so it
// lands in a real, inspectable file. The file is UNTRUSTED on read, so loads pass through
// normalizeSession (the trust boundary). Writes are debounced; a synchronous flush on quit makes the
// last layout survive even if the debounce timer hasn't fired.
let current: SessionV1 = EMPTY_SESSION;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

const filePath = (): string => path.join(app.getPath('userData'), 'session.json');

export async function loadSession(): Promise<SessionV1> {
  try {
    current = normalizeSession(JSON.parse(await fs.readFile(filePath(), 'utf8')));
  } catch {
    current = EMPTY_SESSION; // missing or corrupt → nothing to restore
  }
  return current;
}

export function saveSession(next: unknown): void {
  current = normalizeSession(next); // renderer is across the trust boundary — coerce before persisting
  scheduleWrite();
}

function scheduleWrite(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => void writeNow(), 250);
}

async function writeNow(): Promise<void> {
  writeTimer = null;
  const target = filePath();
  const tmp = `${target}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(current, null, 2), 'utf8');
    await fs.rename(tmp, target); // atomic on same volume
  } catch {
    /* best effort */
  }
}

/**
 * Write the latest session synchronously — call on quit so the final layout isn't lost to the
 * debounce. Unconditional (not gated on a pending timer): on an app-initiated quit, a save that
 * arrives during window teardown updates `current` with no timer of its own, and this still flushes
 * it. Wire it on both before-quit and will-quit so a save landing between the two is still captured.
 */
export function flushSession(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  const target = filePath();
  const tmp = `${target}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(current, null, 2), 'utf8');
    renameSync(tmp, target);
  } catch {
    /* best effort on shutdown */
  }
}
