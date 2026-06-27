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
    let path = decodeURIComponent(url.pathname);
    // Windows drive paths arrive as "/C:/Users/x" — drop the leading slash so node-pty gets "C:/Users/x".
    if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
    // A root-only or empty path (bare "file://", "file:///", "file://host") isn't a usable cwd.
    if (path === '' || path === '/') return undefined;
    return path;
  } catch {
    return undefined;
  }
}
