// Watches ~/.claude/sessions/<pid>.json — the per-PID status file Claude Code maintains — and reports
// each pane's Claude state (busy / waiting / idle / none) to the renderer. Claude writes its OWN state
// here on every transition, so this is far more reliable than scraping the "esc to interrupt" footer
// (the previous approach the user found flaky): it cleanly separates working from needs-input from idle.
//
// Correlation: a session file is keyed by the CLAUDE process PID, which runs inside a pane's pty shell,
// so claude's parent chain includes the pane's shell PID (process-tree.ts). We resolve each claude PID
// to a pane once and cache it (incl. a negative cache for the user's OTHER claude sessions, e.g. in an
// editor), so the costly process-tree snapshot is taken only when a genuinely new claude PID appears.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TermId } from '@shared/ids';
import type { ClaudeStatus } from '@shared/ipc';
import { processParents, findAncestorIn } from './process-tree';

// Claude's per-PID status files. Overridable so an e2e can point at a temp dir (and as an escape hatch
// if a future Claude relocates them) — otherwise the default ~/.claude/sessions.
const SESSIONS_DIR = process.env.SPLITTERM_CLAUDE_SESSIONS_DIR || path.join(os.homedir(), '.claude', 'sessions');
const POLL_MS = 2000; // safety-net cadence; fs.watch drives the low-latency path when it's available
const WATCH_DEBOUNCE_MS = 300; // coalesce bursts (an active Claude rewrites its file rapidly) into one scan
const TREE_COOLDOWN_MS = 750; // min gap between process-tree snapshots — only bites if a shell-out persistently fails

/** Claude's own `status` field → our pane signal. busy = working a turn; waiting = needs the user (e.g.
 *  a permission prompt); everything else (idle / shell / unknown) is "nothing urgent". */
export function mapRawStatus(raw: unknown): Exclude<ClaudeStatus, 'none'> {
  if (raw === 'busy') return 'busy';
  if (raw === 'waiting') return 'waiting';
  return 'idle';
}

export interface ClaudeSession {
  pid: number;
  status: Exclude<ClaudeStatus, 'none'>;
}

/** Parse one ~/.claude/sessions/<pid>.json. Untrusted/foreign file: null on anything malformed. */
export function parseSessionJson(text: string): ClaudeSession | null {
  try {
    const o = JSON.parse(text) as { pid?: unknown; status?: unknown };
    if (typeof o.pid !== 'number' || !Number.isInteger(o.pid)) return null;
    return { pid: o.pid, status: mapRawStatus(o.status) };
  } catch {
    return null;
  }
}

const RANK: Record<Exclude<ClaudeStatus, 'none'>, number> = { busy: 3, waiting: 2, idle: 1 };
/** If two claude sessions map to one pane (rare), the most-active wins: busy > waiting > idle. */
export function mergeStatus(a: Exclude<ClaudeStatus, 'none'>, b: Exclude<ClaudeStatus, 'none'>): Exclude<ClaudeStatus, 'none'> {
  return RANK[a] >= RANK[b] ? a : b;
}

export interface ClaudeWatcherOptions {
  /** the live pane sessions and the OS PID of each one's pty shell */
  listSessions: () => { id: TermId; pid: number }[];
  /** report a pane's Claude status; called only when it changes */
  emit: (id: TermId, status: ClaudeStatus) => void;
}

/**
 * Start watching. Returns a stop() that tears down the timer + fs watcher. Resilient to the sessions
 * dir not existing yet (created when Claude first runs) — the poll re-arms the watch when it appears.
 */
export function startClaudeStatusWatcher(opts: ClaudeWatcherOptions): () => void {
  // claude PID → owning pane TermId, or null = "checked, not one of ours" (a foreign claude session).
  // Keyed by claude PID; evicted when that PID's session file disappears (guards against PID reuse).
  const cache = new Map<number, TermId | null>();
  const lastEmitted = new Map<TermId, ClaudeStatus>();
  let watcher: fs.FSWatcher | null = null;
  let scanning = false;
  let queued = false;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let lastTreeFetch = 0;
  let stopped = false;

  async function readSessions(): Promise<ClaudeSession[]> {
    let names: string[];
    try {
      names = await fsp.readdir(SESSIONS_DIR);
    } catch {
      return []; // dir missing → no claude sessions
    }
    const out: ClaudeSession[] = [];
    await Promise.all(
      names
        .filter((n) => n.endsWith('.json'))
        .map(async (n) => {
          try {
            const s = parseSessionJson(await fsp.readFile(path.join(SESSIONS_DIR, n), 'utf8'));
            if (s) out.push(s);
          } catch {
            /* file vanished mid-read / unreadable — skip */
          }
        }),
    );
    return out;
  }

  async function scan(): Promise<void> {
    if (scanning) {
      queued = true;
      return;
    }
    scanning = true;
    try {
      const claudeSessions = await readSessions();
      const live = opts.listSessions();
      const liveIds = new Set(live.map((s) => s.id));
      const shellPidToId = new Map(live.map((s) => [s.pid, s.id] as const));

      // Evict only OUR panes' resolved entries when that claude exits or its pane closes (PID-reuse safety
      // for our own panes). Foreign sessions (null) stay cached even as their files churn — an active
      // editor / other Claude rewrites them constantly, and re-resolving each change would respawn the
      // costly process-tree query in a tight loop. So a foreign PID is resolved to `null` exactly once.
      const currentPids = new Set(claudeSessions.map((s) => s.pid));
      for (const [pid, paneId] of cache) {
        if (paneId !== null && (!currentPids.has(pid) || !liveIds.has(paneId))) cache.delete(pid);
      }

      // Resolve any uncached claude PIDs against the process tree — one snapshot, gated by a cooldown so a
      // burst of new sessions can't spawn the query back-to-back (unresolved PIDs settle on a later scan).
      const unresolved = claudeSessions.filter((s) => !cache.has(s.pid));
      if (unresolved.length && live.length && Date.now() - lastTreeFetch >= TREE_COOLDOWN_MS) {
        lastTreeFetch = Date.now();
        const parents = await processParents();
        // Only commit results from a SUCCESSFUL snapshot — a failed/empty shell-out must not poison the
        // cache with false 'none's (which the sticky negative cache would then make permanent). On failure
        // the PIDs stay unresolved and retry on the next scan.
        if (parents.size > 0) {
          const shellPids = new Set(live.map((s) => s.pid));
          for (const s of unresolved) {
            const ancestor = findAncestorIn(s.pid, parents, shellPids);
            cache.set(s.pid, ancestor !== undefined ? shellPidToId.get(ancestor)! : null);
          }
        }
      }

      // Fold the resolved sessions into a per-pane status.
      const byPane = new Map<TermId, Exclude<ClaudeStatus, 'none'>>();
      for (const s of claudeSessions) {
        const paneId = cache.get(s.pid);
        if (paneId === null || paneId === undefined) continue;
        const prev = byPane.get(paneId);
        byPane.set(paneId, prev ? mergeStatus(prev, s.status) : s.status);
      }

      // Emit per live pane, only on change.
      for (const { id } of live) {
        const next: ClaudeStatus = byPane.get(id) ?? 'none';
        if (lastEmitted.get(id) !== next) {
          lastEmitted.set(id, next);
          opts.emit(id, next);
        }
      }
      for (const id of lastEmitted.keys()) if (!liveIds.has(id)) lastEmitted.delete(id);
    } finally {
      scanning = false;
      if (queued && !stopped) {
        queued = false;
        void scan();
      }
    }
  }

  function scanDebounced(): void {
    if (debounce) return;
    debounce = setTimeout(() => {
      debounce = null;
      void scan();
    }, WATCH_DEBOUNCE_MS);
  }

  function ensureWatch(): void {
    if (watcher) return;
    try {
      watcher = fs.watch(SESSIONS_DIR, { persistent: false }, scanDebounced);
      watcher.on('error', () => {
        watcher?.close();
        watcher = null; // dir went away — the poll will re-arm when it returns
      });
    } catch {
      watcher = null; // dir not present yet — poll re-attempts
    }
  }

  ensureWatch();
  void scan();
  const timer = setInterval(() => {
    ensureWatch();
    void scan();
  }, POLL_MS);
  timer.unref?.();

  return () => {
    stopped = true;
    clearInterval(timer);
    if (debounce) clearTimeout(debounce);
    watcher?.close();
    watcher = null;
  };
}
