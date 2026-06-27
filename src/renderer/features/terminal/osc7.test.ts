import { describe, it, expect } from 'vitest';
import { parseOsc7 } from './osc7';

describe('parseOsc7', () => {
  it('parses a Windows drive path (drops the leading slash)', () => {
    expect(parseOsc7('file:///C:/Users/foo')).toBe('C:/Users/foo');
    expect(parseOsc7('file://DESKTOP-1/C:/Windows')).toBe('C:/Windows'); // host is ignored
  });

  it('parses a POSIX path (keeps the leading slash)', () => {
    expect(parseOsc7('file:///home/user/project')).toBe('/home/user/project');
    expect(parseOsc7('file://localhost/var/log')).toBe('/var/log');
  });

  it('percent-decodes the path', () => {
    expect(parseOsc7('file:///C:/Program%20Files')).toBe('C:/Program Files');
    expect(parseOsc7('file:///home/a%20b')).toBe('/home/a b');
  });

  it('round-trips URL-significant characters (the shim percent-encodes them)', () => {
    expect(parseOsc7('file:///C:/a%23b')).toBe('C:/a#b'); // '#' would otherwise be a fragment
    expect(parseOsc7('file:///C:/100%25done')).toBe('C:/100%done'); // literal '%'
    expect(parseOsc7('file:///C:/q%3Fx')).toBe('C:/q?x'); // '?' would otherwise be a query
  });

  it('reconstructs a UNC path from a file://server/share URI', () => {
    expect(parseOsc7('file://server/share/dir')).toBe('\\\\server\\share\\dir');
    expect(parseOsc7('file://nas/team%20share/x')).toBe('\\\\nas\\team share\\x');
    expect(parseOsc7('file://server')).toBeUndefined(); // bare host, no share
    expect(parseOsc7('file://localhost/C:/x')).toBe('C:/x'); // localhost is local, not UNC
  });

  it('rejects non-file schemes and garbage', () => {
    expect(parseOsc7('http://example.com/x')).toBeUndefined();
    expect(parseOsc7('not a url')).toBeUndefined();
    expect(parseOsc7('')).toBeUndefined();
    expect(parseOsc7('7;file:///x')).toBeUndefined(); // payload must already be stripped of "7;"
  });

  it('never throws on malformed percent-escapes (untrusted output runs in xterm parser)', () => {
    // decodeURIComponent throws URIError on these; parseOsc7 must stay total and return undefined.
    expect(parseOsc7('file:///a%2')).toBeUndefined();
    expect(parseOsc7('file:///%ZZ')).toBeUndefined();
    expect(parseOsc7('file:///C:/a%ZZ')).toBeUndefined();
    expect(parseOsc7('file:///home/100%done')).toBeUndefined();
  });

  it('treats an empty / root-only path as no cwd (not "/")', () => {
    expect(parseOsc7('file://')).toBeUndefined();
    expect(parseOsc7('file:///')).toBeUndefined();
    expect(parseOsc7('file://localhost')).toBeUndefined();
  });
});
