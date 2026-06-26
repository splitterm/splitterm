import { spawn, type IPty } from 'node-pty';
import fs from 'node:fs';
import type { TermId } from '@shared/ids';
import type { PortLike, SpawnRequest, HostToRenderer } from '@shared/ipc';
import { homeDir, sanitizedEnv, type ResolvedShell } from './shell-detect';

// Watermark flow control: pause node-pty when the renderer is behind, resume when it catches up.
// Bounds CPU + RAM under a flood (yes | cat). See plans/performance.md §5.
const HIGH_WATER = 256 * 1024;
const LOW_WATER = 64 * 1024;

interface Session {
  pty: IPty;
  sent: number;
  acked: number;
  paused: boolean;
}

const sessions = new Map<number, Session>();

// The renderer's firehose port lives here so every session posts to the *current* port and a
// renderer reload (a new port) resets session state in exactly one place — sessions no longer
// capture a port that goes stale on reload.
let firehose: PortLike | null = null;

export function hasFirehose(): boolean {
  return firehose !== null;
}

/**
 * Adopt the renderer's firehose port. A *different* port than before means the renderer reloaded:
 * the previous page is gone, so its sessions are orphaned. With no session restore yet, kill them —
 * leaking them piles up zombie shells, and a paused one would wedge forever (the fresh renderer
 * never acks its TermIds). The first connect has no sessions, so this is a no-op there.
 */
export function rebindFirehose(port: PortLike): void {
  if (firehose && firehose !== port) {
    killAll();
    firehose.close?.();
  }
  firehose = port;
}

function post(msg: HostToRenderer): void {
  firehose?.postMessage(msg);
}

// A requested cwd that doesn't exist makes node-pty throw (or the shell die immediately). Validate
// it and fall back to the home directory so a stale/garbage cwd can't break terminal startup.
function resolveCwd(cwd: string | undefined): string {
  if (cwd) {
    try {
      if (fs.statSync(cwd).isDirectory()) return cwd;
    } catch {
      /* missing or inaccessible → fall back */
    }
  }
  return homeDir();
}

export function spawnPty(id: TermId, opts: SpawnRequest, shell: ResolvedShell, startupCommand?: string): void {
  let pty: IPty;
  try {
    pty = spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cols: opts.cols > 0 ? opts.cols : 80,
      rows: opts.rows > 0 ? opts.rows : 24,
      cwd: resolveCwd(opts.cwd),
      env: sanitizedEnv(),
      useConpty: true,
    });
  } catch (err) {
    // A bad shell path/permissions throws synchronously (e.g. ENOENT). Without this the renderer's
    // pane would hang blank forever (onExit never fires) and the throw could tear down the host.
    // Emit a banner + synthetic exit so the pane shows the failure and never wedges.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[pty-host] spawn failed for ${shell.file}:`, message);
    post({ t: 'data', id, data: `\r\n\x1b[31mFailed to start shell (${shell.file}): ${message}\x1b[0m\r\n` });
    post({ t: 'exit', id, code: 1 });
    return;
  }

  const session: Session = { pty, sent: 0, acked: 0, paused: false };
  sessions.set(id, session);

  let startupSent = !startupCommand;
  pty.onData((data) => {
    post({ t: 'data', id, data });
    // Run the profile's startup command once the shell has produced its first output (prompt ready).
    if (!startupSent) {
      startupSent = true;
      try {
        pty.write(`${startupCommand}\r`);
      } catch {
        /* shell already gone */
      }
    }
    session.sent += data.length;
    if (!session.paused && session.sent - session.acked > HIGH_WATER) {
      session.paused = true;
      pty.pause();
    }
  });

  pty.onExit(({ exitCode, signal }) => {
    post({ t: 'exit', id, code: exitCode, signal });
    sessions.delete(id);
  });
}

export function writePty(id: TermId, data: string): void {
  sessions.get(id)?.pty.write(data);
}

export function resizePty(id: TermId, cols: number, rows: number): void {
  if (cols > 0 && rows > 0) sessions.get(id)?.pty.resize(cols, rows);
}

export function ackPty(id: TermId, bytes: number): void {
  const session = sessions.get(id);
  if (!session) return;
  session.acked += bytes;
  if (session.paused && session.sent - session.acked < LOW_WATER) {
    session.paused = false;
    session.pty.resume();
  }
}

export function killPty(id: TermId): void {
  const session = sessions.get(id);
  if (!session) return;
  session.pty.kill();
  sessions.delete(id);
}

export function killAll(): void {
  for (const session of sessions.values()) {
    try {
      session.pty.kill();
    } catch {
      /* best effort on shutdown */
    }
  }
  sessions.clear();
}
