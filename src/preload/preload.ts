import { contextBridge, ipcRenderer } from 'electron';
import { CONTROL_CHANNELS, type SplittermApi } from '@shared/ipc';

// Main appends `--splitterm-boot=<json>` to the renderer's argv (webPreferences.additionalArguments)
// so we can hand the page a themed appearance snapshot synchronously, before settings load over IPC.
// Parsed defensively — main is the only producer, but a malformed/absent arg must never break boot.
const BOOT_PREFIX = '--splitterm-boot=';
function readBoot(): SplittermApi['boot'] {
  const fallback: SplittermApi['boot'] = { theme: 'Dark', followOS: true, reduceMotion: false };
  try {
    const arg = process.argv.find((a) => a.startsWith(BOOT_PREFIX));
    if (!arg) return fallback;
    const p = JSON.parse(arg.slice(BOOT_PREFIX.length)) as Partial<SplittermApi['boot']>;
    return {
      theme: typeof p.theme === 'string' ? p.theme : fallback.theme,
      followOS: typeof p.followOS === 'boolean' ? p.followOS : fallback.followOS,
      reduceMotion: typeof p.reduceMotion === 'boolean' ? p.reduceMotion : fallback.reduceMotion,
    };
  } catch {
    return fallback;
  }
}

// One frozen, narrow API on window.splitterm — typed by the shared contract.
// (The PTY byte firehose MessagePort is bridged via window.postMessage in M1, not here.)
const api: SplittermApi = {
  boot: readBoot(),
  pty: {
    spawn: (req) => ipcRenderer.invoke(CONTROL_CHANNELS.ptySpawn, req),
    kill: (req) => ipcRenderer.invoke(CONTROL_CHANNELS.ptyKill, req),
    profiles: () => ipcRenderer.invoke(CONTROL_CHANNELS.ptyProfiles),
    onHostCrashed: (cb) => {
      const listener = (): void => cb();
      ipcRenderer.on(CONTROL_CHANNELS.ptyHostCrashed, listener);
      return () => ipcRenderer.removeListener(CONTROL_CHANNELS.ptyHostCrashed, listener);
    },
  },
  settings: {
    get: () => ipcRenderer.invoke(CONTROL_CHANNELS.settingsGet),
    set: (patch) => ipcRenderer.invoke(CONTROL_CHANNELS.settingsSet, patch),
    onChange: (cb) => {
      const listener = (_e: unknown, settings: Parameters<typeof cb>[0]) => cb(settings);
      ipcRenderer.on(CONTROL_CHANNELS.settingsChanged, listener);
      return () => ipcRenderer.removeListener(CONTROL_CHANNELS.settingsChanged, listener);
    },
  },
  clipboard: {
    readText: () => ipcRenderer.invoke(CONTROL_CHANNELS.clipboardRead),
    writeText: (text) => ipcRenderer.invoke(CONTROL_CHANNELS.clipboardWrite, text),
  },
  session: {
    get: () => ipcRenderer.invoke(CONTROL_CHANNELS.sessionGet),
    // send (not invoke) so the final save on pagehide dispatches synchronously before unload.
    save: (session) => ipcRenderer.send(CONTROL_CHANNELS.sessionSave, session),
  },
  app: {
    version: () => ipcRenderer.invoke(CONTROL_CHANNELS.appVersion),
    bootReady: () => ipcRenderer.send(CONTROL_CHANNELS.bootReady),
    splashDone: () => ipcRenderer.send(CONTROL_CHANNELS.splashDone),
  },
};

contextBridge.exposeInMainWorld('splitterm', api);

// A MessagePort can't cross contextBridge as a function arg, so forward it to the page via
// window.postMessage with a transfer list. The renderer listens for this tagged message.
// Pin the target origin to our own page (not '*') so the port can't be handed to a navigated-away
// document — nav lockdown already prevents that, but the handshake shouldn't rely on a single guard.
ipcRenderer.on(CONTROL_CHANNELS.ptyPort, (e) => {
  window.postMessage({ __splittermPort: true }, window.location.origin, e.ports);
});
