import { describe, it, expect } from 'vitest';
import {
  chordFromEvent,
  normalizeChord,
  matchAction,
  formatChord,
  DEFAULT_KEYBINDINGS,
  KEYBINDINGS,
  type ChordKey,
} from './keymap';

const key = (over: Partial<ChordKey>): ChordKey => ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code: '', ...over });

describe('chordFromEvent', () => {
  it('builds a canonical chord with modifiers in Ctrl/Alt/Shift/Meta order', () => {
    expect(chordFromEvent(key({ altKey: true, shiftKey: true, code: 'Equal' }))).toBe('Alt+Shift+Equal');
    expect(chordFromEvent(key({ ctrlKey: true, shiftKey: true, code: 'KeyW' }))).toBe('Ctrl+Shift+KeyW');
    expect(chordFromEvent(key({ metaKey: true, ctrlKey: true, code: 'KeyA' }))).toBe('Ctrl+Meta+KeyA');
  });
  it('returns null for a bare modifier or empty code', () => {
    expect(chordFromEvent(key({ ctrlKey: true, code: 'ControlLeft' }))).toBeNull();
    expect(chordFromEvent(key({ shiftKey: true, code: 'ShiftRight' }))).toBeNull();
    expect(chordFromEvent(key({ code: '' }))).toBeNull();
  });
  it('allows an unmodified key', () => {
    expect(chordFromEvent(key({ code: 'F2' }))).toBe('F2');
  });
});

describe('normalizeChord', () => {
  it('canonicalizes modifier order', () => {
    expect(normalizeChord('Shift+Alt+Equal')).toBe('Alt+Shift+Equal');
    expect(normalizeChord('Meta+Ctrl+KeyA')).toBe('Ctrl+Meta+KeyA');
  });
  it('accepts a valid chord unchanged', () => {
    expect(normalizeChord('Ctrl+Shift+KeyW')).toBe('Ctrl+Shift+KeyW');
    expect(normalizeChord('Alt+ArrowLeft')).toBe('Alt+ArrowLeft');
  });
  it('rejects malformed chords', () => {
    expect(normalizeChord('Ctrl+Shift')).toBeNull(); // no key code
    expect(normalizeChord('Hyper+KeyA')).toBeNull(); // unknown modifier
    expect(normalizeChord('Ctrl+Ctrl+KeyA')).toBeNull(); // duplicate modifier
    expect(normalizeChord('')).toBeNull();
    expect(normalizeChord(42)).toBeNull();
  });
  it('rejects an unrecognized key code (typo like "W" instead of "KeyW")', () => {
    expect(normalizeChord('Ctrl+W')).toBeNull();
    expect(normalizeChord('Ctrl+keyW')).toBeNull();
    expect(normalizeChord('Alt+Left')).toBeNull(); // real code is ArrowLeft
  });
  it('requires a modifier for ordinary keys, but allows bare function keys', () => {
    expect(normalizeChord('KeyA')).toBeNull(); // would shadow typing "a"
    expect(normalizeChord('ArrowLeft')).toBeNull();
    expect(normalizeChord('Enter')).toBeNull();
    expect(normalizeChord('F5')).toBe('F5');
    expect(normalizeChord('Ctrl+KeyA')).toBe('Ctrl+KeyA');
  });
});

describe('matchAction', () => {
  it('finds the action bound to a chord', () => {
    expect(matchAction('Alt+Shift+Equal', DEFAULT_KEYBINDINGS)).toBe('splitRight');
    expect(matchAction('Ctrl+Shift+KeyW', DEFAULT_KEYBINDINGS)).toBe('closePane');
    expect(matchAction('Alt+ArrowLeft', DEFAULT_KEYBINDINGS)).toBe('focusLeft');
  });
  it('returns null for an unbound chord', () => {
    expect(matchAction('Ctrl+KeyQ', DEFAULT_KEYBINDINGS)).toBeNull();
  });
});

describe('formatChord', () => {
  it('renders friendly key labels', () => {
    expect(formatChord('Alt+Shift+Equal')).toBe('Alt+Shift+=');
    expect(formatChord('Ctrl+Shift+KeyW')).toBe('Ctrl+Shift+W');
    expect(formatChord('Alt+ArrowLeft')).toBe('Alt+←');
    expect(formatChord('Ctrl+Digit1')).toBe('Ctrl+1');
    expect(formatChord('F5')).toBe('F5');
  });
});

describe('defaults', () => {
  it('every action has a valid default chord', () => {
    for (const action of KEYBINDINGS) {
      expect(normalizeChord(DEFAULT_KEYBINDINGS[action])).toBe(DEFAULT_KEYBINDINGS[action]);
    }
  });
});
