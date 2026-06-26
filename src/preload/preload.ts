import { contextBridge, ipcRenderer } from 'electron';
import { CONTROL_CHANNELS, type SplittermApi } from '@shared/ipc';

// One frozen, narrow API on window.splitterm — typed by the shared contract.
// (The PTY byte firehose MessagePort is bridged via window.postMessage in M1, not here.)
const api: SplittermApi = {
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
  app: {
    version: () => ipcRenderer.invoke(CONTROL_CHANNELS.appVersion),
  },
};

contextBridge.exposeInMainWorld('splitterm', api);

// A MessagePort can't cross contextBridge as a function arg, so forward it to the page via
// window.postMessage with a transfer list. The renderer listens for this tagged message.
ipcRenderer.on(CONTROL_CHANNELS.ptyPort, (e) => {
  window.postMessage({ __splittermPort: true }, '*', e.ports);
});
