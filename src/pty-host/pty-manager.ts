import { spawn, type IPty } from 'node-pty';
import fs from 'node:fs';
import type { TermId } from '@shared/ids';
import type { PortLike, SpawnRequest, HostToRenderer, ClaudeStatus } from '@shared/ipc';
import { homeDir, sanitizedEnv, type ResolvedShell } from './shell-detect';
import { withShellIntegration } from './shell-integration';

// Watermark flow control: pause node-pty when the renderer is behind on acks, resume when it catches
// up. Bounds CPU + RAM under a flood (yes | cat). Thresholds count UTF-16 code units (xterm string
// length), NOT bytes — so the real memory bound runs ~2-3× higher for wide (e.g. CJK) output. Both
// ends count the same unit, so the backpressure logic stays correct. See plans/performance.md §5.
const HIGH_WATER = 256 * 1024; // code units (~chars), not bytes
const LOW_WATER = 64 * 1024;

// Wait this long after the shell's output goes quiet before sending a profile's startup command —
// the first bytes are ConPTY/banner setup, not the prompt, and writing too early can drop it.
const STARTUP_SETTLE_MS = 250;

interface Session {
  pty: IPty;
  pid: number; // the pty shell's OS PID — used to correlate Claude sessions to this pane (claude-status.ts)
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

export function spawnPty(id: TermId, opts: SpawnRequest, shell: ResolvedShell, startupCommands?: string[]): void {
  // Optionally inject OSC 7 cwd reporting into PowerShell (so cwd-on-split works on a stock prompt).
  const eff = withShellIntegration(shell, opts.shellIntegration ?? false);
  let pty: IPty;
  try {
    pty = spawn(eff.file, eff.args, {
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

  const session: Session = { pty, pid: pty.pid, sent: 0, acked: 0, paused: false };
  sessions.set(id, session);

  let startupArmed = !!(startupCommands && startupCommands.length > 0);
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  pty.onData((data) => {
    post({ t: 'data', id, data });
    // Send the profile's startup sequence once output has settled (the prompt is ready) rather than on
    // the first byte: re-arm a short timer on every chunk so it fires only after the shell goes quiet.
    // The shell buffers stdin, so writing the commands back-to-back runs them in order.
    if (startupArmed) {
      if (startupTimer) clearTimeout(startupTimer);
      startupTimer = setTimeout(() => {
        startupArmed = false;
        try {
          for (const cmd of startupCommands ?? []) pty.write(`${cmd}\r`);
        } catch {
          /* shell already gone */
        }
      }, STARTUP_SETTLE_MS);
    }
    session.sent += data.length;
    if (!session.paused && session.sent - session.acked > HIGH_WATER) {
      session.paused = true;
      pty.pause();
    }
  });

  pty.onExit(({ exitCode, signal }) => {
    if (startupTimer) clearTimeout(startupTimer); // never write into a shell that already exited
    post({ t: 'exit', id, code: exitCode, signal });
    sessions.delete(id);
  });
}

/** The live pane sessions + each one's pty shell PID — for correlating Claude sessions to panes. */
export function liveSessions(): { id: TermId; pid: number }[] {
  return [...sessions].map(([id, s]) => ({ id: id as TermId, pid: s.pid }));
}

/** Push a pane's correlated Claude status to the renderer over the firehose (no-op if no port yet). */
export function emitClaudeStatus(id: TermId, status: ClaudeStatus): void {
  post({ t: 'claude', id, status });
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
