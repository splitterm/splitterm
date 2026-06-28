// Owns the renderer end of the PTY firehose MessagePort. Incoming data is coalesced per
// terminal and flushed once per animation frame (bounds render work to the refresh rate, no
// matter the output rate). Outgoing input/resize/ack go straight over the port.
import type { TermId } from '@shared/ids';
import type { HostToRenderer, RendererToHost } from '@shared/ipc';
import { parseHostToRenderer } from '@shared/ipc';
import { ipc } from './ipc-client';

interface TerminalHandlers {
  onData: (data: string) => void;
  onExit: (code: number) => void;
}

// Per-terminal buffer: data chunks, plus a terminal exit code once the session ends. Both are flushed
// on the same rAF so `exit` is delivered AFTER any data buffered before it (otherwise a spawn-failure
// banner — sent as data then exit — could render the "[process exited]" line before the error).
interface Pending {
  chunks: string[];
  exit?: number;
}

const handlers = new Map<number, TerminalHandlers>();
const pending = new Map<number, Pending>();
let port: MessagePort | null = null;
let rafScheduled = false;

// Resolves once the firehose port has attached. Spawning before then (e.g. a "+" click or a session
// restore during the renderer's reload gap) would race the host's orphan-kill and lose the pane, so
// callers await this first. A timeout unblocks spawns even if the bridge never arrives.
let markPortReady!: () => void;
const portReady = new Promise<void>((resolve) => {
  markPortReady = resolve;
  setTimeout(resolve, 5000);
});
export function whenPortReady(): Promise<void> {
  return portReady;
}

const HOST_CRASH_BANNER = '\r\n\x1b[1;31m[pty-host crashed — this terminal ended. Open a new one.]\x1b[0m\r\n';

/**
 * The pty-host died, taking every live session with it. Show a banner on each registered terminal so
 * panes don't silently freeze — the renderer stays up and new terminals work against the respawned
 * host. The failed sessions are then dropped (their `onExit` will never arrive over the dead port),
 * so a second crash only banners panes that are actually live, and stale handlers don't accumulate.
 */
function failAll(): void {
  for (const handler of handlers.values()) handler.onData(HOST_CRASH_BANNER);
  handlers.clear();
  pending.clear();
}

/** Install the window listener that receives the port bridged from preload. Call once at boot. */
export function initPortBridge(): void {
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window) return; // only the preload's same-window handoff, never a foreign frame
    const tagged = e.data && (e.data as { __splittermPort?: boolean }).__splittermPort;
    const incoming = e.ports[0];
    if (tagged && incoming) attachPort(incoming);
  });
  ipc.pty.onHostCrashed(failAll);
}

function attachPort(p: MessagePort): void {
  port?.close(); // release a stale port on reconnect (dev reload)
  port = p;
  p.onmessage = (e: MessageEvent) => {
    const msg = parseHostToRenderer(e.data);
    if (msg) onMessage(msg);
  };
  p.start();
  markPortReady(); // unblock any spawns that were waiting for the port
}

function bufFor(id: number): Pending {
  let buf = pending.get(id);
  if (!buf) {
    buf = { chunks: [] };
    pending.set(id, buf);
  }
  return buf;
}

function onMessage(msg: HostToRenderer): void {
  if (msg.t === 'data') {
    bufFor(msg.id).chunks.push(msg.data);
    scheduleFlush();
  } else if (msg.t === 'exit') {
    // Buffer the exit too, so it lands after the data that preceded it on the next flush.
    bufFor(msg.id).exit = msg.code;
    scheduleFlush();
  }
}

function scheduleFlush(): void {
  if (rafScheduled) return;
  rafScheduled = true;
  requestAnimationFrame(flush);
}

function flush(): void {
  rafScheduled = false;
  for (const [id, buf] of pending) {
    const handler = handlers.get(id);
    if (!handler) {
      // No handler: a buffered exit means the pane is already gone (its kill's exit arrived after
      // unregister re-created the entry) — reap it so closed terminals don't leak. Plain early data
      // with no exit stays buffered until the terminal registers.
      if (buf.exit !== undefined) pending.delete(id);
      continue;
    }
    if (buf.chunks.length > 0) {
      handler.onData(buf.chunks.join(''));
      buf.chunks = [];
    }
    if (buf.exit !== undefined) {
      handler.onExit(buf.exit);
      pending.delete(id); // session ended — nothing more will arrive for this id
    }
  }
}

function send(msg: RendererToHost): void {
  port?.postMessage(msg);
}

export function registerTerminal(id: TermId, onData: (d: string) => void, onExit: (code: number) => void): void {
  handlers.set(id, { onData, onExit });
  if (pending.has(id)) scheduleFlush(); // drain anything buffered before registration
}

export function unregisterTerminal(id: TermId): void {
  handlers.delete(id);
  pending.delete(id);
}

export function writeToPty(id: TermId, data: string): void {
  send({ t: 'write', id, data });
}

export function resizePty(id: TermId, cols: number, rows: number): void {
  send({ t: 'resize', id, cols, rows });
}

export function ackPty(id: TermId, bytes: number): void {
  send({ t: 'ack', id, bytes });
}
