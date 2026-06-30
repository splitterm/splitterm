// The PTY firehose travels over a direct MessageChannel between the pty-host utilityProcess
// and the renderer (brokered once by main). Messages are tagged by TermId so a single channel
// multiplexes every terminal. See plans/architecture.md §3.
//
// node-pty's API is string-based (it decodes bytes to UTF-16 internally), so the firehose
// carries strings; xterm.write(string) consumes them directly. (The binary/transferable
// discussion in the plan applies to byte-sourced PTYs; cross-process payloads are copied
// either way — throughput comes from rAF batching + flow control, not transferables.)
import type { TermId } from '../ids';

/**
 * A pane's correlated Claude Code session state, derived in the host from `~/.claude/sessions/<pid>.json`:
 * `busy` = processing a turn → claudeWorking; `waiting` = needs the user (e.g. a permission prompt) →
 * attention; `idle` = correlated but between turns; `none` = no Claude session is correlated to the pane
 * (so the renderer falls back to its generic output/affordance heuristics).
 */
export type ClaudeStatus = 'busy' | 'waiting' | 'idle' | 'none';

export type HostToRenderer =
  | { t: 'data'; id: TermId; data: string }
  | { t: 'exit'; id: TermId; code: number; signal?: number }
  | { t: 'claude'; id: TermId; status: ClaudeStatus };

export type RendererToHost =
  | { t: 'write'; id: TermId; data: string }
  | { t: 'resize'; id: TermId; cols: number; rows: number }
  /** backpressure ack: chars consumed by xterm, so the host can pause/resume node-pty */
  | { t: 'ack'; id: TermId; bytes: number };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * Validate an inbound renderer→host firehose message. The renderer is sandboxed, so the host (which
 * spawns shells) must not trust the wire — a malformed message is rejected (null) rather than fed
 * into pty.write/resize. Pure (no DOM/Electron), so it lives next to the protocol in shared/.
 */
export function parseRendererToHost(v: unknown): RendererToHost | null {
  if (!isObj(v) || typeof v.id !== 'number') return null;
  const id = v.id as TermId;
  switch (v.t) {
    case 'write':
      return typeof v.data === 'string' ? { t: 'write', id, data: v.data } : null;
    case 'resize':
      return typeof v.cols === 'number' && typeof v.rows === 'number'
        ? { t: 'resize', id, cols: v.cols, rows: v.rows }
        : null;
    case 'ack':
      return typeof v.bytes === 'number' ? { t: 'ack', id, bytes: v.bytes } : null;
    default:
      return null;
  }
}

/** Validate an inbound host→renderer firehose message — the symmetric guard for the renderer end. */
export function parseHostToRenderer(v: unknown): HostToRenderer | null {
  if (!isObj(v) || typeof v.id !== 'number') return null;
  const id = v.id as TermId;
  switch (v.t) {
    case 'data':
      return typeof v.data === 'string' ? { t: 'data', id, data: v.data } : null;
    case 'exit': {
      if (typeof v.code !== 'number') return null;
      const msg: Extract<HostToRenderer, { t: 'exit' }> = { t: 'exit', id, code: v.code };
      if (typeof v.signal === 'number') msg.signal = v.signal;
      return msg;
    }
    case 'claude':
      return v.status === 'busy' || v.status === 'waiting' || v.status === 'idle' || v.status === 'none'
        ? { t: 'claude', id, status: v.status }
        : null;
    default:
      return null;
  }
}

/**
 * Minimal MessagePort surface used by both ends, declared here so shared/ stays free of the
 * DOM lib. The renderer supplies a real `MessagePort`; the host a `MessagePortMain`.
 */
export interface PortLike {
  postMessage(message: unknown, transfer?: unknown[]): void;
  start?(): void;
  on?(event: 'message', listener: (e: { data: unknown }) => void): void;
  onmessage?: ((e: { data: unknown }) => void) | null;
  close?(): void;
}
