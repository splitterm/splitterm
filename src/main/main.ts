import { app, BrowserWindow, ipcMain, Menu, session, type WebContents } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import { CONTROL_CHANNELS } from '@shared/ipc';
import type { Settings } from '@shared/domain/settings.schema';
import { startPtyHost, connectRendererPort, stopPtyHost, syncUserProfiles } from './pty-supervisor';
import { loadSettings, getSettings, setSettings, onSettingsChange } from './settings-store';
import { isAllowedNavigation } from './nav-guard';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const isMac = process.platform === 'darwin';

// Content-Security-Policy delivered as a response header — stronger than the <meta> fallback in
// index.html (it covers every response and can set header-only directives like frame-ancestors).
// Local app shell, so 'self' only; 'unsafe-inline' for styles is required by xterm + design tokens.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "object-src 'none'; base-uri 'none'; frame-ancestors 'none';";

const applyCspHeaders = (): void => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const u = details.url;
    const isAppContent = u.startsWith('http://') || u.startsWith('https://') || u.startsWith('file://');
    callback(
      isAppContent
        ? { responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } }
        : { responseHeaders: details.responseHeaders }, // leave devtools:// etc. untouched
    );
  });
};

// The only page the window should ever sit on: the dev-server origin in dev, or exactly the
// packaged index.html in prod (pinned to one file, not the whole file: scheme — see nav-guard).
const DEV_ORIGIN = MAIN_WINDOW_VITE_DEV_SERVER_URL ? new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin : null;
const APP_FILE_URL = pathToFileURL(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)).href;
const isAppUrl = (target: string): boolean => isAllowedNavigation(target, DEV_ORIGIN, APP_FILE_URL);

// Navigation lockdown: this is a local app shell, never a browser. Deny every new-window/popup
// request and block any top-level navigation away from the app's own page, so a malicious link or
// injected script can't turn the window into an arbitrary web view. (Electron security checklist.)
const lockNavigation = (contents: WebContents): void => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });
  contents.on('will-redirect', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });
};

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
      v8CacheOptions: 'code', // cache compiled JS for a faster cold start (pin the default explicitly)
    },
  });

  win.once('ready-to-show', () => win.show());

  lockNavigation(win.webContents);

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

// On any settings change: push user profiles + default to the pty-host and broadcast to all renderers.
onSettingsChange((settings) => {
  syncUserProfiles(settings.profiles, settings.defaultProfileId);
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(CONTROL_CHANNELS.settingsChanged, settings);
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null); // frameless terminal: no menu bar, and drop default accelerators (Ctrl+W…)
  applyCspHeaders();
  startPtyHost();
  await loadSettings();
  syncUserProfiles(getSettings().profiles, getSettings().defaultProfileId);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('before-quit', () => stopPtyHost());
