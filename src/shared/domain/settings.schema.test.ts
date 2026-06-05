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

  it('normalize never throws and returns a valid Settings object for garbage input', () => {
    const s = normalize({ nonsense: true, appearance: 42 });
    expect(s.schemaVersion).toBe(DEFAULTS.schemaVersion);
    expect(typeof s.appearance.theme).toBe('string');
    expect(typeof s.terminal.scrollback).toBe('number');
  });
});
