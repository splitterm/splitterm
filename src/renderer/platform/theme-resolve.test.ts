import { describe, it, expect } from 'vitest';
import { resolveThemeAttr } from './theme-resolve';

const base = { theme: 'JetBrains Dark' as const, followOS: false, reduceMotion: false };

describe('resolveThemeAttr', () => {
  it('follows the OS: dark -> default (JetBrains Dark), light -> light', () => {
    expect(resolveThemeAttr({ ...base, followOS: true }, true)).toBe('');
    expect(resolveThemeAttr({ ...base, followOS: true }, false)).toBe('light');
  });

  it('followOS never selects OLED (manual-only)', () => {
    expect(resolveThemeAttr({ theme: 'OLED Black', followOS: true, reduceMotion: false }, true)).toBe('');
    expect(resolveThemeAttr({ theme: 'OLED Black', followOS: true, reduceMotion: false }, false)).toBe('light');
  });

  it('maps the explicit theme when not following the OS', () => {
    expect(resolveThemeAttr({ ...base, theme: 'JetBrains Dark' }, true)).toBe('');
    expect(resolveThemeAttr({ ...base, theme: 'OLED Black' }, true)).toBe('oled');
    expect(resolveThemeAttr({ ...base, theme: 'Light' }, true)).toBe('light');
  });

  it('ignores the OS preference when not following', () => {
    expect(resolveThemeAttr({ ...base, theme: 'OLED Black' }, false)).toBe('oled');
    expect(resolveThemeAttr({ ...base, theme: 'JetBrains Dark' }, false)).toBe('');
  });
});
