import { describe, it, expect } from 'vitest';
import { mapRawStatus, parseSessionJson, mergeStatus } from './claude-status';

describe('mapRawStatus', () => {
  it('passes busy and waiting through', () => {
    expect(mapRawStatus('busy')).toBe('busy');
    expect(mapRawStatus('waiting')).toBe('waiting');
  });

  it('treats idle / shell / unknown / non-string as idle (nothing urgent)', () => {
    for (const v of ['idle', 'shell', 'whatever', '', undefined, 42, null]) {
      expect(mapRawStatus(v)).toBe('idle');
    }
  });
});

describe('parseSessionJson', () => {
  it('parses a real busy session line', () => {
    expect(parseSessionJson('{"pid":37172,"status":"busy","cwd":"C:\\\\dev\\\\x"}')).toEqual({ pid: 37172, status: 'busy' });
  });

  it('maps a waiting (permission prompt) session to waiting', () => {
    expect(parseSessionJson('{"pid":5,"status":"waiting","waitingFor":"permission prompt"}')).toEqual({ pid: 5, status: 'waiting' });
  });

  it('defaults a missing / non-actionable status to idle but keeps the pid', () => {
    expect(parseSessionJson('{"pid":9}')).toEqual({ pid: 9, status: 'idle' });
    expect(parseSessionJson('{"pid":9,"status":"shell"}')).toEqual({ pid: 9, status: 'idle' });
  });

  it('rejects a missing / non-integer pid', () => {
    expect(parseSessionJson('{"status":"busy"}')).toBeNull();
    expect(parseSessionJson('{"pid":"x","status":"busy"}')).toBeNull();
    expect(parseSessionJson('{"pid":1.5}')).toBeNull();
  });

  it('rejects malformed JSON', () => {
    expect(parseSessionJson('not json')).toBeNull();
    expect(parseSessionJson('')).toBeNull();
  });
});

describe('mergeStatus', () => {
  it('ranks busy > waiting > idle regardless of argument order', () => {
    expect(mergeStatus('busy', 'waiting')).toBe('busy');
    expect(mergeStatus('waiting', 'busy')).toBe('busy');
    expect(mergeStatus('waiting', 'idle')).toBe('waiting');
    expect(mergeStatus('idle', 'waiting')).toBe('waiting');
    expect(mergeStatus('idle', 'idle')).toBe('idle');
  });
});
