// PTY-host utilityProcess entry — one process hosting ALL node-pty shells, keyed by TermId.
// Receives a MessagePortMain (the firehose to the renderer) plus control messages from main.
import type { TermId } from '@shared/ids';
import type { PortLike, SpawnRequest } from '@shared/ipc';
import { parseRendererToHost } from '@shared/ipc';
import type { UserProfile } from '@shared/domain/profile';
import { spawnPty, writePty, resizePty, ackPty, killPty, killAll, rebindFirehose, hasFirehose, liveSessions, emitClaudeStatus } from './pty-manager';
import { resolveShell, detectProfiles, type ShellProfileFull } from './shell-detect';
import { resolveLaunch, type ResolvedLaunch } from './resolve-launch';
import { startClaudeStatusWatcher } from './claude-status';

// Control messages main → host (over the utilityProcess parentPort).
type HostControl =
  | { type: 'connect' }
  | { type: 'spawn'; id: TermId; opts: SpawnRequest }
  | { type: 'kill'; id: TermId }
  | { type: 'user-profiles'; profiles: UserProfile[]; defaultProfileId: string };

// `process.parentPort` is the Electron utilityProcess channel (not typed by @types/node).
interface ParentPortEvent {
  data: unknown;
  ports: PortLike[];
}
const parentPort = (process as unknown as {
  parentPort?: {
    on(event: 'message', listener: (e: ParentPortEvent) => void): void;
    postMessage(message: unknown): void;
  };
}).parentPort;

let fullProfiles: ShellProfileFull[] = []; // detected shells (with file/args)
let userProfiles: UserProfile[] = []; // user-defined profiles (synced from main/settings)
let defaultProfileId = ''; // the profile the "+" button opens (no explicit profileId); '' = OS shell
// Spawns can arrive before the renderer's firehose port is connected; queue and drain on connect.
const pendingSpawns: Array<{ id: TermId; opts: SpawnRequest; launch: ResolvedLaunch }> = [];

function launch(id: TermId, opts: SpawnRequest, l: ResolvedLaunch): void {
  spawnPty(id, opts, { file: l.file, args: l.args }, l.startupCommands);
}

function onPortMessage(e: { data: unknown }): void {
  // The firehose carries renderer-supplied messages; validate before touching node-pty so a
  // malformed (or hostile) message is dropped instead of crashing the host.
  const msg = parseRendererToHost(e.data);
  if (!msg) return;
  switch (msg.t) {
    case 'write':
      writePty(msg.id, msg.data);
      break;
    case 'resize':
      resizePty(msg.id, msg.cols, msg.rows);
      break;
    case 'ack':
      ackPty(msg.id, msg.bytes);
      break;
  }
}

parentPort?.on('message', (e) => {
  const msg = e.data as HostControl;
  switch (msg.type) {
    case 'connect': {
      const port = e.ports[0];
      if (!port) break;
      rebindFirehose(port); // adopt the new port; kills sessions orphaned by a renderer reload
      port.start?.();
      port.on?.('message', onPortMessage);
      for (const s of pendingSpawns) launch(s.id, s.opts, s.launch);
      pendingSpawns.length = 0;
      break;
    }
    case 'spawn': {
      const l = resolveLaunch(msg.opts.profileId, fullProfiles, userProfiles, defaultProfileId, resolveShell, msg.opts.restore, msg.opts.noCommands);
      if (hasFirehose()) launch(msg.id, msg.opts, l);
      else pendingSpawns.push({ id: msg.id, opts: msg.opts, launch: l });
      break;
    }
    case 'kill':
      killPty(msg.id);
      break;
    case 'user-profiles':
      userProfiles = msg.profiles;
      defaultProfileId = msg.defaultProfileId;
      break;
  }
});

// Watch ~/.claude/sessions for per-pane Claude Code status (busy/waiting/idle), correlated to panes by
// process tree. Runs for the host's lifetime; emits over the (current) firehose, a no-op until connected.
startClaudeStatusWatcher({ listSessions: liveSessions, emit: emitClaudeStatus });

// Detect available shell profiles off the hot path; report id+label to main for the UI.
void detectProfiles()
  .then((list) => {
    fullProfiles = list;
    parentPort?.postMessage({ type: 'profiles', list: list.map((p) => ({ id: p.id, label: p.label })) });
  })
  .catch((err) => console.error('[pty-host] profile detection failed:', err));

process.on('exit', killAll);
