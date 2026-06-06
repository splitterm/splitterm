import { spawn, type IPty } from 'node-pty';
import type { TermId } from '@shared/ids';
import type { PortLike, SpawnRequest } from '@shared/ipc';
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

export function spawnPty(
  id: TermId,
  opts: SpawnRequest,
  port: PortLike,
  shell: ResolvedShell,
  startupCommand?: string,
): void {
  const pty = spawn(shell.file, shell.args, {
    name: 'xterm-256color',
    cols: opts.cols > 0 ? opts.cols : 80,
    rows: opts.rows > 0 ? opts.rows : 24,
    cwd: opts.cwd ?? homeDir(),
    env: sanitizedEnv(),
    useConpty: true,
  });

  const session: Session = { pty, sent: 0, acked: 0, paused: false };
  sessions.set(id, session);

  let startupSent = !startupCommand;
  pty.onData((data) => {
    port.postMessage({ t: 'data', id, data });
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
    port.postMessage({ t: 'exit', id, code: exitCode, signal });
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
