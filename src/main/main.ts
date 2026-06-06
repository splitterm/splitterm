import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { CONTROL_CHANNELS } from '@shared/ipc';
import type { Settings } from '@shared/domain/settings.schema';
import { startPtyHost, connectRendererPort, stopPtyHost, syncUserProfiles } from './pty-supervisor';
import { loadSettings, getSettings, setSettings, onSettingsChange } from './settings-store';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const isMac = process.platform === 'darwin';

const createWindow = (): void => {
  const win = new BrowserWindow({
    width: 1024,
    height: 680,
    minWidth: 480,
    minHeight: 320,
    backgroundColor: '#1E1F22', // no white flash before first paint
    show: false,
    titleBarStyle: 'hidden',
    // Native min/max/close on Windows/Linux; macOS shows traffic lights with 'hidden'.
    ...(isMac
      ? { trafficLightPosition: { x: 12, y: 11 } }
      : { titleBarOverlay: { color: '#1E1F22', symbolColor: '#CED0D6', height: 36 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false, // keep terminals rendering when unfocused
    },
  });

  win.once('ready-to-show', () => win.show());

  // Hand the renderer its end of the PTY firehose once the page has loaded.
  win.webContents.on('did-finish-load', () => connectRendererPort(win));

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
};

ipcMain.handle(CONTROL_CHANNELS.appVersion, () => app.getVersion());
ipcMain.handle(CONTROL_CHANNELS.settingsGet, () => getSettings());
ipcMain.handle(CONTROL_CHANNELS.settingsSet, (_e, patch: Partial<Settings>) => {
  setSettings(patch);
});

// On any settings change: push user profiles to the pty-host and broadcast to all renderers.
onSettingsChange((settings) => {
  syncUserProfiles(settings.profiles);
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(CONTROL_CHANNELS.settingsChanged, settings);
  }
});

app.whenReady().then(async () => {
  startPtyHost();
  await loadSettings();
  syncUserProfiles(getSettings().profiles);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('before-quit', () => stopPtyHost());
