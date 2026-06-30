import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeTheme, session, type IpcMainEvent, type WebContents } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import { CONTROL_CHANNELS } from '@shared/ipc';
import type { Settings } from '@shared/domain/settings.schema';
import { startPtyHost, connectRendererPort, stopPtyHost, syncUserProfiles } from './pty-supervisor';
import { loadSettings, getSettings, setSettings, onSettingsChange } from './settings-store';
import { loadSession, saveSession, flushSession } from './session-store';
import { isAllowedNavigation } from './nav-guard';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const isMac = process.platform === 'darwin';

// MUST equal tokens.css --titlebar-h — the topbar height; the renderer paints the topbar/body separator
// at exactly this y (.body border-top, base.css).
const TITLEBAR_H = 36;
// The native caption-button overlay is painted 2px SHORTER than the topbar. Its background fill spans
// [0, OVERLAY_H) on the right; making that end above the separator (at y = TITLEBAR_H) is what lets the
// hairline run the FULL width — UNDER the buttons too — instead of being clipped at the controls. (The
// buttons just sit a hair higher in the bar; the gap below them is bg-app, so it's invisible.)
const OVERLAY_H = TITLEBAR_H - 2;

// Chrome colours per resolved theme, mirroring tokens.css (--bg-app + --text-secondary). The native
// caption buttons then match the topbar EXACTLY: the overlay bg blends into bg-app, and the min/max/
// close glyphs are the same colour as the topbar's own icons — not a brighter default that stands out.
// OLED is manual-only; followOS flips between Dark and Light against the OS scheme.
const THEME_CHROME = {
  dark: { bg: '#1E1F22', symbol: '#9DA0A8' },
  oled: { bg: '#000000', symbol: '#8B8D94' },
  light: { bg: '#FFFFFF', symbol: '#6C707E' },
} as const;
type Chrome = (typeof THEME_CHROME)[keyof typeof THEME_CHROME];
const resolveChrome = (a: Settings['appearance']): Chrome => {
  if (a.followOS) return nativeTheme.shouldUseDarkColors ? THEME_CHROME.dark : THEME_CHROME.light;
  if (a.theme === 'OLED Black') return THEME_CHROME.oled;
  if (a.theme === 'Light') return THEME_CHROME.light;
  return THEME_CHROME.dark;
};
// `hidden` (boot): symbolColor === bg so the controls vanish into the splash; revealed, the glyphs
// take the theme's icon colour so they read as part of the topbar.
const overlayFor = (c: Chrome, hidden = false): { color: string; symbolColor: string; height: number } => ({
  color: c.bg,
  symbolColor: hidden ? c.bg : c.symbol,
  height: OVERLAY_H, // 2px short of the topbar so the body separator clears the caption buttons (full-width line)
});

// Windows whose caption controls have been revealed (post-splash). Gates the live re-theme below so a
// settings change DURING boot can't reveal the controls early over the splash.
const revealed = new WeakSet<BrowserWindow>();
// Reveal the native window controls hidden during the boot splash, matched to the current theme.
// Idempotent: both the renderer's splash-done signal and a failsafe timer call it, whichever lands first.
const revealWindowChrome = (win: BrowserWindow): void => {
  if (win.isDestroyed()) return;
  revealed.add(win);
  if (isMac) win.setWindowButtonVisibility(true);
  else win.setTitleBarOverlay(overlayFor(resolveChrome(getSettings().appearance)));
};
// Re-theme the window chrome when the theme changes (a settings edit, or with followOS the OS scheme)
// so it keeps matching the topbar instead of standing out in the previous theme's colours. Repaints
// BOTH the resize-gutter backgroundColor (all platforms) and the native caption-button overlay (Win/
// Linux only — macOS traffic lights adapt on their own).
const reThemeChrome = (): void => {
  const c = resolveChrome(getSettings().appearance);
  const overlay = overlayFor(c);
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || !revealed.has(win)) continue;
    win.setBackgroundColor(c.bg); // else a post-switch resize-grow flashes the old theme in the gutter
    if (!isMac) win.setTitleBarOverlay(overlay);
  }
};

// The minimal appearance snapshot the renderer needs to theme the splash + first paint before its
// own settings IPC resolves. The renderer resolves theme/followOS against the OS colour scheme.
const bootArg = (appearance: Settings['appearance']): string =>
  `--splitterm-boot=${JSON.stringify({
    theme: appearance.theme,
    followOS: appearance.followOS,
    reduceMotion: appearance.reduceMotion,
  })}`;

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
  // Defense-in-depth: also block a subframe (iframe) from navigating off the app's own page.
  contents.on('will-frame-navigate', (e) => {
    if (!isAppUrl(e.url)) e.preventDefault();
  });
};

const createWindow = (): void => {
  // The window is born hidden in the resolved theme's chrome colour, so when it finally shows it is
  // already the user's theme — never the default-dark splash.
  const chrome = resolveChrome(getSettings().appearance);
  const win = new BrowserWindow({
    width: 1024,
    height: 680,
    minWidth: 480,
    minHeight: 320,
    // Governs pre-paint / resize-gutter fills (the window is hidden until the renderer themes + paints,
    // so this is never seen as a flash) — match the resolved theme so any gutter fill blends in.
    backgroundColor: chrome.bg,
    show: false,
    titleBarStyle: 'hidden',
    // Native min/max/close on Windows/Linux; macOS shows traffic lights with 'hidden'. Both start
    // hidden into the splash (overlay symbol === bg) and are revealed, theme-matched, when it ends.
    ...(isMac
      ? { trafficLightPosition: { x: 12, y: 11 } }
      : { titleBarOverlay: overlayFor(chrome, true) }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false, // keep terminals rendering when unfocused
      v8CacheOptions: 'code', // cache compiled JS for a faster cold start (pin the default explicitly)
      // Hand the renderer a themed appearance snapshot synchronously, so the boot splash and first
      // paint match the user's theme before settings arrive over async IPC (preload reads this).
      additionalArguments: [bootArg(getSettings().appearance)],
    },
  });

  // macOS has no titleBarOverlay to recolour, so hide the traffic lights outright during boot.
  if (isMac) win.setWindowButtonVisibility(false);

  // Show the window only once the renderer has applied the theme and painted its first (themed) splash
  // frame — signalled by app:boot-ready. Deferring from ready-to-show is what removes the brief
  // default-dark screen before the real theme resolves. Failsafe: show anyway after 4s if the renderer
  // never signals (e.g. a bundle error), so a broken boot can't trap the user behind a hidden window.
  let shown = false;
  const showOnce = (): void => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    win.show();
  };
  const onBootReady = (e: IpcMainEvent): void => {
    if (e.sender === win.webContents) showOnce();
  };
  ipcMain.on(CONTROL_CHANNELS.bootReady, onBootReady);
  const showFailsafe = setTimeout(showOnce, 4000);
  let revealFailsafe: ReturnType<typeof setTimeout> | undefined;
  win.on('closed', () => {
    ipcMain.removeListener(CONTROL_CHANNELS.bootReady, onBootReady);
    clearTimeout(showFailsafe);
    if (revealFailsafe) clearTimeout(revealFailsafe);
  });

  win.once('ready-to-show', () => {
    // Failsafe: if the renderer never signals splash completion (e.g. a bundle error), don't leave
    // the window controls hidden in the splash canvas forever.
    revealFailsafe = setTimeout(() => revealWindowChrome(win), 6000);
  });

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
ipcMain.on(CONTROL_CHANNELS.splashDone, (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) revealWindowChrome(win);
});
ipcMain.handle(CONTROL_CHANNELS.clipboardRead, () => clipboard.readText());
ipcMain.handle(CONTROL_CHANNELS.clipboardWrite, (_e, text: unknown) => {
  // The renderer is the only caller, but it sits across the trust boundary — coerce to a string.
  clipboard.writeText(typeof text === 'string' ? text : '');
});
ipcMain.handle(CONTROL_CHANNELS.sessionGet, () => loadSession());
ipcMain.on(CONTROL_CHANNELS.sessionSave, (_e, session: unknown) => saveSession(session));
// Persist the final layout synchronously on quit. Both events: on a window-close quit the renderer's
// pagehide save reaches main before before-quit; on an app-initiated quit (Cmd+Q) it can arrive after,
// so will-quit (after windows tear down) gives that late save a second chance to be flushed.
app.on('before-quit', () => flushSession());
app.on('will-quit', () => flushSession());
ipcMain.handle(CONTROL_CHANNELS.settingsGet, () => getSettings());
ipcMain.handle(CONTROL_CHANNELS.settingsSet, (_e, patch: Partial<Settings>) => {
  setSettings(patch);
});

// On any settings change: push user profiles + default to the pty-host, broadcast to all renderers, and
// re-theme the native caption buttons so a theme switch keeps them matching the topbar.
onSettingsChange((settings) => {
  syncUserProfiles(settings.profiles, settings.defaultProfileId);
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(CONTROL_CHANNELS.settingsChanged, settings);
  }
  reThemeChrome();
});
// followOS: when the OS colour scheme flips, the resolved theme changes too — repaint the overlay.
nativeTheme.on('updated', reThemeChrome);

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null); // frameless terminal: no menu bar, and drop default accelerators (Ctrl+W…)
  applyCspHeaders();
  startPtyHost();
  await loadSettings();
  // Load the saved session into `current` at boot so the quit-flush never writes a stale empty
  // session over the real layout — e.g. when restore is off and the renderer never requests it.
  await loadSession();
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
