import { describe, it, expect } from 'vitest';
import { DEFAULTS, normalize } from './settings.schema';

describe('settings schema', () => {
  it('ships sane defaults', () => {
    expect(DEFAULTS.schemaVersion).toBe(1);
    expect(DEFAULTS.appearance.theme).toBe('JetBrains Dark');
    expect(DEFAULTS.appearance.followOS).toBe(true);
    expect(DEFAULTS.terminal.scrollback).toBeGreaterThan(0);
    expect(DEFAULTS.font.size).toBeGreaterThan(0);
  });
});

describe('normalize', () => {
  it('never throws and returns a valid Settings object for garbage input', () => {
    const s = normalize({ nonsense: true, appearance: 42 });
    expect(s.schemaVersion).toBe(DEFAULTS.schemaVersion);
    expect(typeof s.appearance.theme).toBe('string');
    expect(typeof s.terminal.scrollback).toBe('number');
    expect(Array.isArray(s.profiles)).toBe(true);
  });

  it.each([null, undefined, 42, 'string', [], true])(
    'returns the full defaults for non-object input %p',
    (input) => {
      expect(normalize(input)).toEqual(DEFAULTS);
    },
  );

  it('fills missing fields from DEFAULTS (partial input)', () => {
    const s = normalize({ appearance: { theme: 'OLED Black' } });
    expect(s.appearance.theme).toBe('OLED Black');
    expect(s.appearance.followOS).toBe(DEFAULTS.appearance.followOS);
    expect(s.font).toEqual(DEFAULTS.font);
    expect(s.terminal).toEqual(DEFAULTS.terminal);
  });

  it('preserves a fully valid config unchanged', () => {
    const valid = {
      schemaVersion: 1,
      appearance: { theme: 'Light', followOS: false, reduceMotion: true },
      font: { family: 'Fira Code', size: 16 },
      terminal: { scrollback: 5000, cursorStyle: 'bar' as const, cursorBlink: false },
      profiles: [{ id: 'p1', name: 'Claude', baseShellId: 'pwsh', startupCommand: 'claude' }],
      defaultProfileId: 'p1',
    };
    expect(normalize(valid)).toEqual(valid);
  });

  describe('defaultProfileId', () => {
    it('defaults to empty string', () => expect(normalize({}).defaultProfileId).toBe(''));
    it('keeps a string id', () => expect(normalize({ defaultProfileId: 'pwsh' }).defaultProfileId).toBe('pwsh'));
    it.each([42, null, {}, ['x']])('falls back to "" for non-string %p', (defaultProfileId) =>
      expect(normalize({ defaultProfileId }).defaultProfileId).toBe(''));
    it('bounds the length', () =>
      expect(normalize({ defaultProfileId: 'x'.repeat(500) }).defaultProfileId).toHaveLength(200));
  });

  it('is idempotent', () => {
    const messy = {
      font: { size: 9999 },
      terminal: { scrollback: -50, cursorStyle: 'spiral' },
      profiles: [{ id: 'a', baseShellId: 'b', startupCommand: 'x\ny' }, 'junk'],
    };
    const once = normalize(messy);
    expect(normalize(once)).toEqual(once);
  });

  it('drops unknown top-level keys', () => {
    const s = normalize({ schemaVersion: 1, malicious: 'rm -rf', extra: { nested: true } }) as unknown as Record<
      string,
      unknown
    >;
    expect(s.malicious).toBeUndefined();
    expect(s.extra).toBeUndefined();
    expect(Object.keys(s).sort()).toEqual([
      'appearance',
      'defaultProfileId',
      'font',
      'profiles',
      'schemaVersion',
      'terminal',
    ]);
  });

  describe('font.size', () => {
    it('clamps below the minimum', () => expect(normalize({ font: { size: 1 } }).font.size).toBe(6));
    it('clamps above the maximum', () => expect(normalize({ font: { size: 9999 } }).font.size).toBe(72));
    it.each([NaN, Infinity, -Infinity, '13', null])('falls back for non-finite %p', (size) => {
      expect(normalize({ font: { size } }).font.size).toBe(DEFAULTS.font.size);
    });
  });

  describe('terminal.scrollback', () => {
    it('rejects negatives', () => expect(normalize({ terminal: { scrollback: -1 } }).terminal.scrollback).toBe(0));
    it('clamps absurd values', () =>
      expect(normalize({ terminal: { scrollback: 5e9 } }).terminal.scrollback).toBe(1_000_000));
    it('truncates floats to int', () =>
      expect(normalize({ terminal: { scrollback: 100.9 } }).terminal.scrollback).toBe(100));
    it('falls back for a string', () =>
      expect(normalize({ terminal: { scrollback: '1000' } }).terminal.scrollback).toBe(DEFAULTS.terminal.scrollback));
  });

  describe('terminal.cursorStyle', () => {
    it.each(['block', 'bar', 'underline'])('accepts %s', (cursorStyle) =>
      expect(normalize({ terminal: { cursorStyle } }).terminal.cursorStyle).toBe(cursorStyle));
    it('falls back for an unknown style', () =>
      expect(normalize({ terminal: { cursorStyle: 'beam' } }).terminal.cursorStyle).toBe(DEFAULTS.terminal.cursorStyle));
  });

  describe('booleans', () => {
    it.each([1, 'true', 0, null, {}])('coerces non-boolean followOS %p to the default', (followOS) =>
      expect(normalize({ appearance: { followOS } }).appearance.followOS).toBe(DEFAULTS.appearance.followOS));
  });

  describe('appearance.theme', () => {
    it('keeps a custom scheme name', () =>
      expect(normalize({ appearance: { theme: 'My Custom Scheme' } }).appearance.theme).toBe('My Custom Scheme'));
    it.each(['', 123, null])('falls back for non-string / empty theme %p', (theme) =>
      expect(normalize({ appearance: { theme } }).appearance.theme).toBe(DEFAULTS.appearance.theme));
  });

  describe('profiles', () => {
    it('returns [] for a non-array', () => expect(normalize({ profiles: 'nope' }).profiles).toEqual([]));

    it('drops malformed entries, keeps well-formed ones', () => {
      const s = normalize({
        profiles: [
          { id: 'good', name: 'PowerShell', baseShellId: 'pwsh' },
          { name: 'no id', baseShellId: 'pwsh' }, // missing id
          { id: 'no-shell', name: 'x' }, // missing baseShellId
          'string',
          null,
          42,
        ],
      });
      expect(s.profiles).toEqual([{ id: 'good', name: 'PowerShell', baseShellId: 'pwsh' }]);
    });

    it('defaults a missing name to empty string', () =>
      expect(normalize({ profiles: [{ id: 'a', baseShellId: 'b' }] }).profiles).toEqual([
        { id: 'a', name: '', baseShellId: 'b' },
      ]));

    it('drops unknown keys on a profile', () =>
      expect(normalize({ profiles: [{ id: 'a', name: 'n', baseShellId: 'b', evil: 'x', extra: 1 }] }).profiles).toEqual([
        { id: 'a', name: 'n', baseShellId: 'b' },
      ]));

    // SECURITY: startupCommand is written to the pty verbatim — a newline would inject a 2nd command.
    it('forces startupCommand to a single line (strips injected commands)', () =>
      expect(
        normalize({
          profiles: [{ id: 'a', name: 'n', baseShellId: 'b', startupCommand: 'echo hi\nrm -rf /\r\nshutdown' }],
        }).profiles,
      ).toEqual([{ id: 'a', name: 'n', baseShellId: 'b', startupCommand: 'echo hi' }]));

    it('omits startupCommand when it is not a string', () =>
      expect(normalize({ profiles: [{ id: 'a', name: 'n', baseShellId: 'b', startupCommand: 123 }] }).profiles).toEqual([
        { id: 'a', name: 'n', baseShellId: 'b' },
      ]));

    it('omits startupCommand that is empty after stripping the first newline', () =>
      expect(normalize({ profiles: [{ id: 'a', name: 'n', baseShellId: 'b', startupCommand: '\nrm -rf /' }] }).profiles).toEqual([
        { id: 'a', name: 'n', baseShellId: 'b' },
      ]));

    it('bounds startupCommand length', () =>
      expect(normalize({ profiles: [{ id: 'a', name: 'n', baseShellId: 'b', startupCommand: 'x'.repeat(5000) }] }).profiles[0]?.startupCommand).toHaveLength(2000));
  });
});
