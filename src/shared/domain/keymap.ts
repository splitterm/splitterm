// The keyboard-shortcut domain: the rebindable tiling actions, their default chords, and PURE helpers
// to turn a key event into a chord, validate/canonicalize a stored chord, match a chord to an action,
// and format a chord for display. No DOM/Electron — shared by the settings trust boundary (main +
// renderer) and the tiling engine. A "chord" is a canonical string: modifiers in a fixed order
// (Ctrl, Alt, Shift, Meta) then a KeyboardEvent.code, joined by '+', e.g. "Alt+Shift+Equal".

/** The tiling actions a user can rebind. */
export const KEYBINDINGS = [
  'splitRight',
  'splitDown',
  'closePane',
  'toggleZoom',
  'focusLeft',
  'focusRight',
  'focusUp',
  'focusDown',
] as const;

export type ActionId = (typeof KEYBINDINGS)[number];

export const DEFAULT_KEYBINDINGS: Record<ActionId, string> = {
  splitRight: 'Alt+Shift+Equal',
  splitDown: 'Alt+Shift+Minus',
  closePane: 'Ctrl+Shift+KeyW',
  toggleZoom: 'Ctrl+Shift+Enter',
  focusLeft: 'Alt+ArrowLeft',
  focusRight: 'Alt+ArrowRight',
  focusUp: 'Alt+ArrowUp',
  focusDown: 'Alt+ArrowDown',
};

/** Human labels for the settings UI. */
export const ACTION_LABELS: Record<ActionId, string> = {
  splitRight: 'Split right',
  splitDown: 'Split down',
  closePane: 'Close pane',
  toggleZoom: 'Toggle zoom',
  focusLeft: 'Focus left',
  focusRight: 'Focus right',
  focusUp: 'Focus up',
  focusDown: 'Focus down',
};

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
const MODIFIER_SET = new Set<string>(MODIFIERS);
// Recognized KeyboardEvent.code values for the key part of a chord. Guards against a typo'd code
// (e.g. "W" instead of "KeyW") that would canonicalize cleanly yet never match a real event.
const VALID_CODE =
  /^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2])|Arrow(Left|Right|Up|Down)|Enter|Space|Tab|Backspace|Escape|Delete|Insert|Home|End|PageUp|PageDown|Equal|Minus|Comma|Period|Slash|Backslash|BracketLeft|BracketRight|Semicolon|Quote|Backquote|Numpad([0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter))$/;
// Keys that may be bound WITHOUT a modifier; everything else needs one, so a binding can't shadow
// ordinary typing (e.g. a bare "a" splitting panes).
const BARE_OK = /^F([1-9]|1[0-2])$/;
// Bare modifier key codes — a chord can't be just a modifier.
const MODIFIER_CODES = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
]);

/** The event fields a chord is built from (a structural subset of KeyboardEvent — no DOM dependency). */
export interface ChordKey {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  code: string;
}

/** Build a canonical chord from a key event, or null for a bare modifier / empty code. */
export function chordFromEvent(e: ChordKey): string | null {
  if (!e.code || MODIFIER_CODES.has(e.code)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  parts.push(e.code);
  return parts.join('+');
}

/**
 * Validate + canonicalize a stored chord string (modifiers reordered to Ctrl/Alt/Shift/Meta, the
 * key code last). Returns null for anything malformed: no code, a bare modifier, an unknown modifier,
 * or a duplicate. The trust boundary uses this to coerce settings.json.
 */
export function normalizeChord(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const parts = s.split('+').map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const code = parts[parts.length - 1]!;
  const mods = parts.slice(0, -1);
  if (!VALID_CODE.test(code)) return null; // the last part must be a recognized key code
  const seen = new Set<string>();
  for (const m of mods) {
    if (!MODIFIER_SET.has(m) || seen.has(m)) return null; // unknown or duplicate modifier
    seen.add(m);
  }
  if (seen.size === 0 && !BARE_OK.test(code)) return null; // ordinary keys need at least one modifier
  const out: string[] = [];
  for (const m of MODIFIERS) if (seen.has(m)) out.push(m);
  out.push(code);
  return out.join('+');
}

/** Which action (if any) a chord is bound to. First match by KEYBINDINGS order (deterministic). */
export function matchAction(chord: string, bindings: Record<string, string>): ActionId | null {
  for (const action of KEYBINDINGS) if (bindings[action] === chord) return action;
  return null;
}

const CODE_LABELS: Record<string, string> = {
  Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  Enter: 'Enter', Space: 'Space', Tab: 'Tab', Backspace: 'Backspace', Escape: 'Esc',
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backquote: '`',
};

/** A friendly chord for display, e.g. "Alt+Shift+Equal" → "Alt+Shift+=", "Ctrl+Shift+KeyW" → "Ctrl+Shift+W". */
export function formatChord(chord: string): string {
  const parts = chord.split('+');
  const code = parts[parts.length - 1] ?? '';
  const mods = parts.slice(0, -1);
  let label = CODE_LABELS[code];
  if (label === undefined) {
    if (/^Key[A-Z]$/.test(code)) label = code.slice(3);
    else if (/^Digit[0-9]$/.test(code)) label = code.slice(5);
    else if (/^F[0-9]{1,2}$/.test(code)) label = code; // F1..F12
    else label = code;
  }
  return [...mods, label].join('+');
}
