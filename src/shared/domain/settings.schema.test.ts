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
      appearance: { theme: 'Light', followOS: false, reduceMotion: true, focusBorderColor: '#ff8800' },
      font: { family: 'Fira Code', size: 16 },
      terminal: {
        scrollback: 5000,
        cursorStyle: 'bar' as const,
        cursorInactiveStyle: 'none' as const,
        cursorBlink: false,
        lineHeight: 1.4,
        letterSpacing: 1,
        fontWeight: 500,
        shellIntegration: false,
        webgl: true,
      },
      profiles: [{ id: 'p1', name: 'Claude', baseShellId: 'pwsh', startupCommands: ['claude'], restoreCommands: ['claude --continue'] }],
      defaultProfileId: 'p1',
      restoreSession: false,
      restoreScrollback: true,
      restorePathOnly: true,
      keybindings: { ...DEFAULTS.keybindings, splitRight: 'Ctrl+KeyD' },
    };
    expect(normalize(valid)).toEqual(valid);
  });

  describe('appearance.focusBorderColor', () => {
    it('keeps a 6-digit #hex and expands a 3-digit one to #rrggbb', () => {
      expect(normalize({ appearance: { focusBorderColor: '#ff8800' } }).appearance.focusBorderColor).toBe('#ff8800');
      expect(normalize({ appearance: { focusBorderColor: '#fa0' } }).appearance.focusBorderColor).toBe('#ffaa00');
    });
    it('rejects non-hex so it cannot inject into the CSS var', () => {
      for (const bad of ['red', 'rgb(1,2,3)', '#xyz', '#1234', 'url(x)', 'blue;}', 42])
        expect(normalize({ appearance: { focusBorderColor: bad } }).appearance.focusBorderColor).toBe('');
    });
    it('defaults to empty', () => expect(normalize({}).appearance.focusBorderColor).toBe(''));
  });

  describe('restorePathOnly', () => {
    it('defaults to false', () => expect(normalize({}).restorePathOnly).toBe(false));
    it('keeps a boolean', () => expect(normalize({ restorePathOnly: true }).restorePathOnly).toBe(true));
    it.each([1, 'yes', null, {}])('falls back to default for non-boolean %p', (restorePathOnly) =>
      expect(normalize({ restorePathOnly }).restorePathOnly).toBe(false));
  });

  describe('defaultProfileId', () => {
    it('defaults to empty string', () => expect(normalize({}).defaultProfileId).toBe(''));
    it('keeps a string id', () => expect(normalize({ defaultProfileId: 'pwsh' }).defaultProfileId).toBe('pwsh'));
    it.each([42, null, {}, ['x']])('falls back to "" for non-string %p', (defaultProfileId) =>
      expect(normalize({ defaultProfileId }).defaultProfileId).toBe(''));
    it('bounds the length', () =>
      expect(normalize({ defaultProfileId: 'x'.repeat(500) }).defaultProfileId).toHaveLength(200));
  });

  describe('restoreSession', () => {
    it('defaults to true', () => expect(normalize({}).restoreSession).toBe(true));
    it('keeps a boolean', () => expect(normalize({ restoreSession: false }).restoreSession).toBe(false));
    it.each([1, 'yes', null, {}])('falls back to default for non-boolean %p', (restoreSession) =>
      expect(normalize({ restoreSession }).restoreSession).toBe(true));
  });

  describe('restoreScrollback', () => {
    it('defaults to false (opt-in)', () => expect(normalize({}).restoreScrollback).toBe(false));
    it('keeps a boolean', () => expect(normalize({ restoreScrollback: true }).restoreScrollback).toBe(true));
    it.each([1, 'yes', null, {}])('falls back to default for non-boolean %p', (restoreScrollback) =>
      expect(normalize({ restoreScrollback }).restoreScrollback).toBe(false));
  });

  describe('keybindings', () => {
    it('defaults to the full default chord set', () =>
      expect(normalize({}).keybindings).toEqual(DEFAULTS.keybindings));
    it('keeps a valid (canonicalized) override and defaults the rest', () => {
      const kb = normalize({ keybindings: { splitRight: 'Shift+Alt+KeyD' } }).keybindings;
      expect(kb.splitRight).toBe('Alt+Shift+KeyD'); // canonicalized modifier order
      expect(kb.closePane).toBe(DEFAULTS.keybindings.closePane); // untouched action keeps its default
    });
    it('falls back to the default for a malformed chord, and drops unknown actions', () => {
      const kb = normalize({ keybindings: { closePane: 'Ctrl+Ctrl', bogusAction: 'Ctrl+KeyZ' } }) as unknown as {
        keybindings: Record<string, string>;
      };
      expect(kb.keybindings.closePane).toBe(DEFAULTS.keybindings.closePane);
      expect(kb.keybindings.bogusAction).toBeUndefined();
    });
    it('always emits exactly the known actions', () =>
      expect(Object.keys(normalize({ keybindings: 'nope' }).keybindings).sort()).toEqual(
        Object.keys(DEFAULTS.keybindings).sort(),
      ));
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
      'keybindings',
      'profiles',
      'restorePathOnly',
      'restoreScrollback',
      'restoreSession',
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

  describe('terminal.webgl', () => {
    it('defaults to false (opt-in)', () => expect(normalize({}).terminal.webgl).toBe(false));
    it('keeps a boolean', () => expect(normalize({ terminal: { webgl: true } }).terminal.webgl).toBe(true));
    it.each([1, 'true', null, {}])('falls back to the default for non-boolean %p', (webgl) =>
      expect(normalize({ terminal: { webgl } }).terminal.webgl).toBe(DEFAULTS.terminal.webgl));
  });

  describe('terminal.cursorStyle', () => {
    it.each(['block', 'bar', 'underline'])('accepts %s', (cursorStyle) =>
      expect(normalize({ terminal: { cursorStyle } }).terminal.cursorStyle).toBe(cursorStyle));
    it('falls back for an unknown style', () =>
      expect(normalize({ terminal: { cursorStyle: 'beam' } }).terminal.cursorStyle).toBe(DEFAULTS.terminal.cursorStyle));
  });

  describe('terminal display (lineHeight / letterSpacing / fontWeight / cursorInactiveStyle)', () => {
    it('clamps lineHeight to [1, 2]', () => {
      expect(normalize({ terminal: { lineHeight: 0.2 } }).terminal.lineHeight).toBe(1);
      expect(normalize({ terminal: { lineHeight: 5 } }).terminal.lineHeight).toBe(2);
      expect(normalize({ terminal: { lineHeight: 1.4 } }).terminal.lineHeight).toBe(1.4);
    });
    it('clamps letterSpacing to [-5, 10] and falls back for non-numbers', () => {
      expect(normalize({ terminal: { letterSpacing: 99 } }).terminal.letterSpacing).toBe(10);
      expect(normalize({ terminal: { letterSpacing: -99 } }).terminal.letterSpacing).toBe(-5);
      expect(normalize({ terminal: { letterSpacing: 'x' } }).terminal.letterSpacing).toBe(DEFAULTS.terminal.letterSpacing);
    });
    it('snaps fontWeight to the nearest 100 within [100, 900]', () => {
      expect(normalize({ terminal: { fontWeight: 540 } }).terminal.fontWeight).toBe(500);
      expect(normalize({ terminal: { fontWeight: 560 } }).terminal.fontWeight).toBe(600);
      expect(normalize({ terminal: { fontWeight: 50 } }).terminal.fontWeight).toBe(100);
      expect(normalize({ terminal: { fontWeight: 9999 } }).terminal.fontWeight).toBe(900);
      expect(normalize({ terminal: { fontWeight: 'bold' } }).terminal.fontWeight).toBe(DEFAULTS.terminal.fontWeight);
    });
    it('accepts known cursorInactiveStyle values and falls back otherwise', () => {
      expect(normalize({ terminal: { cursorInactiveStyle: 'none' } }).terminal.cursorInactiveStyle).toBe('none');
      expect(normalize({ terminal: { cursorInactiveStyle: 'spiral' } }).terminal.cursorInactiveStyle).toBe(
        DEFAULTS.terminal.cursorInactiveStyle,
      );
    });
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

    // SECURITY: each command is written to the pty verbatim — a newline would inject a 2nd command.
    it('forces each command in the sequence to a single line (strips injected commands)', () =>
      expect(
        normalize({
          profiles: [{ id: 'a', name: 'n', baseShellId: 'b', startupCommands: ['echo hi\nrm -rf /', 'ls\r\nshutdown'] }],
        }).profiles,
      ).toEqual([{ id: 'a', name: 'n', baseShellId: 'b', startupCommands: ['echo hi', 'ls'] }]));

    it('folds a legacy single startupCommand into startupCommands', () =>
      expect(normalize({ profiles: [{ id: 'a', name: 'n', baseShellId: 'b', startupCommand: 'claude' }] }).profiles).toEqual([
        { id: 'a', name: 'n', baseShellId: 'b', startupCommands: ['claude'] },
      ]));

    it('prefers startupCommands over a legacy startupCommand when both are present', () =>
      expect(
        normalize({ profiles: [{ id: 'a', name: 'n', baseShellId: 'b', startupCommand: 'legacy', startupCommands: ['new'] }] })
          .profiles[0]?.startupCommands,
      ).toEqual(['new']));

    it('coerces restoreCommands the same way (single-line, dropped when empty)', () => {
      expect(normalize({ profiles: [{ id: 'a', name: 'n', baseShellId: 'b', restoreCommands: ['claude --continue\nrm'] }] }).profiles[0]?.restoreCommands).toEqual(['claude --continue']);
      expect(normalize({ profiles: [{ id: 'a', name: 'n', baseShellId: 'b', restoreCommands: [] }] }).profiles[0]?.restoreCommands).toBeUndefined();
    });

    it('omits a command list that is not an array / has no usable strings', () => {
      expect(normalize({ profiles: [{ id: 'a', name: 'n', baseShellId: 'b', startupCommands: 'claude' }] }).profiles[0]?.startupCommands).toBeUndefined();
      expect(normalize({ profiles: [{ id: 'a', name: 'n', baseShellId: 'b', startupCommands: [123, '', '\n'] }] }).profiles[0]?.startupCommands).toBeUndefined();
    });

    it('bounds each command length and caps the sequence length', () => {
      const p = normalize({
        profiles: [{ id: 'a', name: 'n', baseShellId: 'b', startupCommands: [...Array(30).fill('x'.repeat(5000))] }],
      }).profiles[0];
      expect(p?.startupCommands).toHaveLength(20); // MAX_COMMANDS
      expect(p?.startupCommands?.[0]).toHaveLength(2000); // STARTUP_COMMAND_MAX
    });
  });
});
