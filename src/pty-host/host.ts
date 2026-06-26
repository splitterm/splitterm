// PTY-host utilityProcess entry — one process hosting ALL node-pty shells, keyed by TermId.
// Receives a MessagePortMain (the firehose to the renderer) plus control messages from main.
import type { TermId } from '@shared/ids';
import type { PortLike, SpawnRequest } from '@shared/ipc';
import { parseRendererToHost } from '@shared/ipc';
import type { UserProfile } from '@shared/domain/profile';
import { spawnPty, writePty, resizePty, ackPty, killPty, killAll, rebindFirehose, hasFirehose } from './pty-manager';
import { resolveShell, detectProfiles, type ResolvedShell, type ShellProfileFull } from './shell-detect';

interface ResolvedLaunch extends ResolvedShell {
  startupCommand?: string;
}

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

// Resolve a profile id (a detected shell OR a user profile) to a launchable shell + startup command.
// With no explicit id (the "+" button), fall back to the configured default profile, then the OS shell.
function resolveLaunch(profileId?: string): ResolvedLaunch {
  const effective = profileId || defaultProfileId;
  if (effective) {
    const detected = fullProfiles.find((x) => x.id === effective);
    if (detected) return { file: detected.file, args: detected.args };
    const user = userProfiles.find((x) => x.id === effective);
    if (user) {
      const base = fullProfiles.find((x) => x.id === user.baseShellId);
      const shell = base ? { file: base.file, args: base.args } : resolveShell();
      return { ...shell, startupCommand: user.startupCommand };
    }
    console.warn(`[pty-host] unknown profile "${effective}", using default shell`);
  }
  return resolveShell();
}

function launch(id: TermId, opts: SpawnRequest, l: ResolvedLaunch): void {
  spawnPty(id, opts, { file: l.file, args: l.args }, l.startupCommand);
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
      const l = resolveLaunch(msg.opts.profileId);
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

// Detect available shell profiles off the hot path; report id+label to main for the UI.
void detectProfiles()
  .then((list) => {
    fullProfiles = list;
    parentPort?.postMessage({ type: 'profiles', list: list.map((p) => ({ id: p.id, label: p.label })) });
  })
  .catch((err) => console.error('[pty-host] profile detection failed:', err));

process.on('exit', killAll);
