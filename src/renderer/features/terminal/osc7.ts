// Parse an OSC 7 payload — `file://<host>/<path>` — into a local filesystem path, or undefined when
// it isn't a usable local path. Shells emit OSC 7 to report their working directory; splitterm reads
// it so a split opens in the focused pane's directory. The host re-validates the path before spawn
// (a stale/remote dir falls back to home), so this only needs to extract a plausible path. Pure and
// DOM-free so it's unit-testable.
export function parseOsc7(data: string): string | undefined {
  if (!data.startsWith('file://')) return undefined;
  // Total by contract: OSC 7 is untrusted terminal output and this runs inside xterm's (unguarded)
  // write loop, so it must NEVER throw. Both `new URL` (bad URL) and `decodeURIComponent` (a malformed
  // percent-escape like "%ZZ") can throw, so the whole body is guarded.
  try {
    const url = new URL(data);
    if (url.protocol !== 'file:') return undefined;
    const path = decodeURIComponent(url.pathname);
    // A Windows drive path "/C:/Users/x" → "C:/Users/x". A host here is just the reporting machine
    // (e.g. file://DESKTOP/C:/x) — ignore it; the drive letter means it's a local path, not UNC.
    if (/^\/[A-Za-z]:/.test(path)) return path.slice(1);
    // No drive letter but a host → a UNC path: "file://server/share/dir" → "\\server\share\dir".
    const host = url.hostname;
    if (host && host !== 'localhost') {
      if (path === '' || path === '/') return undefined; // bare host with no share isn't a usable cwd
      return `\\\\${host}${path.replace(/\//g, '\\')}`;
    }
    // A root-only or empty POSIX path (bare "file://", "file:///") isn't a usable cwd.
    if (path === '' || path === '/') return undefined;
    return path;
  } catch {
    return undefined;
  }
}
