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

const handlers = new Map<number, TerminalHandlers>();
const pending = new Map<number, string[]>();
let port: MessagePort | null = null;
let rafScheduled = false;

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
}

function onMessage(msg: HostToRenderer): void {
  if (msg.t === 'data') {
    const buf = pending.get(msg.id) ?? [];
    buf.push(msg.data);
    pending.set(msg.id, buf);
    scheduleFlush();
  } else if (msg.t === 'exit') {
    handlers.get(msg.id)?.onExit(msg.code);
  }
}

function scheduleFlush(): void {
  if (rafScheduled) return;
  rafScheduled = true;
  requestAnimationFrame(flush);
}

function flush(): void {
  rafScheduled = false;
  for (const [id, chunks] of pending) {
    const handler = handlers.get(id);
    // Keep buffering if the terminal hasn't registered yet (avoids dropping early output).
    if (!handler || chunks.length === 0) continue;
    handler.onData(chunks.join(''));
    pending.set(id, []);
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
