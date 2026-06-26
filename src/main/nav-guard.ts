// Pure navigation policy for the main window — which URLs the renderer is allowed to sit on.
// Extracted from main.ts so the security boundary is unit-testable without booting Electron.

/**
 * The window is a local app shell, never a browser. Allow ONLY the app's own page:
 * the dev-server origin in dev, or *exactly* the packaged index.html file URL in prod.
 *
 * Pinning the prod case to one file (not the whole `file:` scheme) matters: navigation stays in the
 * same webContents, so any page it lands on inherits the privileged `window.splitterm` bridge. A
 * bare `protocol === 'file:'` check would let a navigation to any local HTML (e.g. a dropped or
 * downloaded file) reach `pty.spawn`. Fails closed on any unparseable URL.
 */
export function isAllowedNavigation(target: string, devOrigin: string | null, appFileUrl: string): boolean {
  try {
    const url = new URL(target);
    if (devOrigin) return url.origin === devOrigin;
    // prod: same file, ignoring hash/query so in-app hash routing still counts as the app page.
    url.hash = '';
    url.search = '';
    return url.href === appFileUrl;
  } catch {
    return false; // unparseable → deny
  }
}
