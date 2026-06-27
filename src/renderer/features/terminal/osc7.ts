// Parse an OSC 7 payload — `file://<host>/<path>` — into a local filesystem path, or undefined when
// it isn't a usable local path. Shells emit OSC 7 to report their working directory; splitterm reads
// it so a split opens in the focused pane's directory. The host re-validates the path before spawn
// (a stale/remote dir falls back to home), so this only needs to extract a plausible path. Pure and
// DOM-free so it's unit-testable.
export function parseOsc7(data: string): string | undefined {
  if (!data.startsWith('file://')) return undefined;
  let url: URL;
  try {
    url = new URL(data);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'file:') return undefined;
  let path = decodeURIComponent(url.pathname);
  // Windows drive paths arrive as "/C:/Users/x" — drop the leading slash so node-pty gets "C:/Users/x".
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  return path || undefined;
}
