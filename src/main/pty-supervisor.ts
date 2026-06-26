import { utilityProcess, MessageChannelMain, ipcMain, BrowserWindow, type UtilityProcess } from 'electron';
import path from 'node:path';
import { CONTROL_CHANNELS, type SpawnRequest, type SpawnResponse, type ShellProfile } from '@shared/ipc';
import type { UserProfile } from '@shared/domain/profile';
import { asTermId, type TermId } from '@shared/ids';

let host: UtilityProcess | null = null;
let hostReady = false;
let shuttingDown = false;
let nextId = 1;
let profiles: ShellProfile[] = [];
let userProfiles: UserProfile[] = [];
let defaultProfileId = ''; // synced to the host so the "+" button (no explicit profile) opens it

// Crash-loop guard: cap how many times we respawn a host that keeps dying right after it starts, so
// a host that crashes on boot doesn't spin forever. Surviving HEALTHY_MS resets the counter.
const MAX_RAPID_RESTARTS = 5;
const HEALTHY_MS = 10_000;
let rapidRestarts = 0;
let lastForkAt = 0;

// Spawns that arrive while the host is down (the boot gap, or the brief window during a respawn) are
// buffered here and replayed once the new host is ready, so a click during recovery isn't lost.
const MAX_PENDING = 64;
const pendingSpawns: Array<{ id: TermId; opts: SpawnRequest }> = [];

// Resolves when the host first reports detected shells, so callers (the sidebar's shell picker,
// the new-terminal menu) never race ahead of detection and get an empty list.
let markProfilesReady: (() => void) | null = null;
const profilesReady = new Promise<void>((resolve) => {
  markProfilesReady = resolve;
});

function notifyHostCrashed(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(CONTROL_CHANNELS.ptyHostCrashed);
  }
}

/** Fork the pty-host utilityProcess and wire its lifecycle. `isRespawn` re-brokers the firehose. */
function forkHost(isRespawn: boolean): void {
  lastForkAt = Date.now();
  host = utilityProcess.fork(path.join(__dirname, 'host.js'), [], { serviceName: 'pty-host' });

  host.on('spawn', () => {
    hostReady = true;
    host?.postMessage({ type: 'user-profiles', profiles: userProfiles, defaultProfileId }); // (re)seed on spawn
    for (const s of pendingSpawns) host?.postMessage({ type: 'spawn', id: s.id, opts: s.opts });
    pendingSpawns.length = 0;
    // On a respawn the renderer's old firehose died with the host — re-broker a fresh one to each
    // window. (On first boot, did-finish-load brokers it instead, so don't double up here.)
    if (isRespawn) for (const w of BrowserWindow.getAllWindows()) connectRendererPort(w);
  });

  host.on('exit', () => {
    hostReady = false;
    host = null;
    if (shuttingDown) return;
    // The host died, taking every PTY with it. Tell renderers so panes show a banner instead of
    // freezing, then respawn so new terminals work again.
    notifyHostCrashed();
    scheduleRestart();
  });

  host.on('message', (msg: unknown) => {
    const m = msg as { type?: string; list?: ShellProfile[] };
    if (m?.type === 'profiles' && Array.isArray(m.list)) {
      profiles = m.list;
      markProfilesReady?.();
      markProfilesReady = null;
    }
  });
}

function scheduleRestart(): void {
  if (Date.now() - lastForkAt > HEALTHY_MS) rapidRestarts = 0; // ran a while → an isolated crash
  rapidRestarts++;
  if (rapidRestarts > MAX_RAPID_RESTARTS) {
    console.error('[pty-supervisor] pty-host keeps crashing on startup; giving up until app restart.');
    return;
  }
  const delay = Math.min(2000, 250 * rapidRestarts);
  setTimeout(() => {
    if (!shuttingDown && !host) forkHost(true);
  }, delay);
}

/** Fork the host and register the lifecycle (spawn/kill/profiles) IPC handlers (once). */
export function startPtyHost(): void {
  forkHost(false);

  // Handlers are registered ONCE here — re-registering them on a respawn throws "second handler".
  ipcMain.handle(CONTROL_CHANNELS.ptySpawn, (_e, req: SpawnRequest): SpawnResponse => {
    const id = asTermId(nextId++);
    if (hostReady && host) host.postMessage({ type: 'spawn', id, opts: req });
    else if (pendingSpawns.length < MAX_PENDING) pendingSpawns.push({ id, opts: req }); // replay on respawn
    return { id };
  });

  ipcMain.handle(CONTROL_CHANNELS.ptyKill, (_e, req: { id: TermId }) => {
    host?.postMessage({ type: 'kill', id: req.id });
  });

  ipcMain.handle(CONTROL_CHANNELS.ptyProfiles, async (): Promise<ShellProfile[]> => {
    // First caller may arrive before detection finishes — wait for it (cap so we never hang).
    if (profiles.length === 0) {
      await Promise.race([profilesReady, new Promise((r) => setTimeout(r, 4000))]);
    }
    return profiles;
  });
}

/**
 * Establish the direct renderer ↔ host MessagePort firehose. Main only brokers the handshake;
 * terminal bytes never flow through main. Re-runs on every load (dev reloads) and on host respawn.
 */
export function connectRendererPort(win: BrowserWindow): void {
  const wire = (): void => {
    if (!host) return;
    const { port1, port2 } = new MessageChannelMain();
    host.postMessage({ type: 'connect' }, [port1]);
    win.webContents.postMessage(CONTROL_CHANNELS.ptyPort, null, [port2]);
  };
  if (hostReady) wire();
  else host?.once('spawn', wire);
}

export function syncUserProfiles(list: UserProfile[], defaultId: string): void {
  userProfiles = list;
  defaultProfileId = defaultId;
  host?.postMessage({ type: 'user-profiles', profiles: list, defaultProfileId });
}

export function stopPtyHost(): void {
  shuttingDown = true;
  host?.kill();
  host = null;
  hostReady = false;
}
