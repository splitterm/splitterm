// Settings type + DEFAULTS + normalize(). Pure data, shared by main (owns the file) and
// the renderer (reads a snapshot). settings.json is UNTRUSTED input: normalize() is the single
// trust boundary that coerces/clamps every field onto the schema before any process consumes it.

import type { UserProfile } from './profile';
import { KEYBINDINGS, DEFAULT_KEYBINDINGS, normalizeChord, type ActionId } from './keymap';
import { STATUS_STATES, type StatusState, type StatusAnim, type ProfileStatus } from './status-appearance';

export type ThemeName = 'Dark' | 'OLED Black' | 'Light' | (string & {});

export interface Settings {
  schemaVersion: number;
  appearance: {
    /** active theme by name (or a user scheme) */
    theme: ThemeName;
    /** auto-switch between "Dark" (OS dark) and "Light" (OS light) */
    followOS: boolean;
    /** collapse motion tokens to 0ms (also honors prefers-reduced-motion) */
    reduceMotion: boolean;
    /** border colour of the focused pane as a #hex; '' = use the theme accent (default) */
    focusBorderColor: string;
    /** sidebar pane-status dot colours as #hex; '' = use the (vibrant) built-in default for that state */
    statusColors: Record<StatusState, string>;
    /** sidebar pane-status dot animation per state; '' = use the built-in default (working/claude pulse) */
    statusAnimations: Record<StatusState, StatusAnim | ''>;
  };
  font: {
    family: string;
    size: number;
  };
  terminal: {
    scrollback: number;
    cursorStyle: 'block' | 'bar' | 'underline';
    /** how the cursor looks when the pane is unfocused */
    cursorInactiveStyle: 'outline' | 'block' | 'bar' | 'underline' | 'none';
    cursorBlink: boolean;
    /** line height as a multiple of the font size (1.0 = tight) */
    lineHeight: number;
    /** extra horizontal space between cells, in pixels */
    letterSpacing: number;
    /** font weight for normal text (100–900) */
    fontWeight: number;
    /** inject OSC 7 cwd reporting into PowerShell so cwd-on-split works on a stock prompt */
    shellIntegration: boolean;
    /** GPU-accelerated rendering (xterm WebGL addon); falls back to the DOM renderer if unavailable */
    webgl: boolean;
  };
  /** user-defined launch profiles, shown in the new-terminal dropdown */
  profiles: UserProfile[];
  /** id of the profile the "+" button opens (detected shell or user profile); '' = OS default shell */
  defaultProfileId: string;
  /** reopen the previous window layout (fresh shells) on launch */
  restoreSession: boolean;
  /**
   * also save & replay each terminal's recent output as read-only history on restore. Opt-in
   * (default off) because it writes terminal output — which may include secrets — to session.json.
   * Only has an effect while restoreSession is on.
   */
  restoreScrollback: boolean;
  /**
   * on restore, reopen each terminal in its saved working directory but do NOT re-run the profile's
   * startup/restore command sequence (so e.g. a `claude` profile reopens a bare shell in the project
   * folder instead of relaunching Claude). Only has an effect while restoreSession is on.
   */
  restorePathOnly: boolean;
  /** keyboard chord per tiling action (action id → canonical chord string, e.g. "Alt+Shift+Equal") */
  keybindings: Record<ActionId, string>;
}

export const DEFAULTS: Settings = {
  schemaVersion: 1,
  appearance: {
    theme: 'Dark',
    followOS: true,
    reduceMotion: false,
    focusBorderColor: '',
    statusColors: { working: '', claudeWorking: '', attention: '', exited: '' },
    statusAnimations: { working: '', claudeWorking: '', attention: '', exited: '' },
  },
  font: { family: 'Cascadia Code, Consolas, ui-monospace, monospace', size: 13 },
  terminal: {
    scrollback: 1000,
    cursorStyle: 'block',
    cursorInactiveStyle: 'outline',
    cursorBlink: true,
    lineHeight: 1.0,
    letterSpacing: 0,
    fontWeight: 400,
    shellIntegration: true,
    webgl: false,
  },
  profiles: [],
  defaultProfileId: '',
  restoreSession: true,
  restoreScrollback: false,
  restorePathOnly: false,
  keybindings: { ...DEFAULT_KEYBINDINGS },
};

// Clamp ranges for numeric fields. Bounds are defensive — wide enough to honor any sane user value,
// tight enough to keep garbage (NaN, negatives, absurd sizes) out of `new Terminal({...})`.
const FONT_SIZE_MIN = 6;
const FONT_SIZE_MAX = 72;
const SCROLLBACK_MIN = 0;
const SCROLLBACK_MAX = 1_000_000;
const STARTUP_COMMAND_MAX = 2000;
const MAX_COMMANDS = 20; // cap a profile's startup/restore sequence so a crafted config can't queue thousands
const CURSOR_STYLES = ['block', 'bar', 'underline'] as const;
const CURSOR_INACTIVE_STYLES = ['outline', 'block', 'bar', 'underline', 'none'] as const;
const LINE_HEIGHT_MIN = 1.0;
const LINE_HEIGHT_MAX = 2.0;
const LETTER_SPACING_MIN = -5;
const LETTER_SPACING_MAX = 10;
const FONT_WEIGHT_MIN = 100;
const FONT_WEIGHT_MAX = 900;

// One profile command: keep only the first line (an embedded newline would inject an extra command
// into the pty) and bound its length. Returns '' for anything unusable.
const oneCommand = (v: string): string => (v.split(/[\r\n]/, 1)[0] ?? '').slice(0, STARTUP_COMMAND_MAX);

// Coerce an untrusted value into a bounded list of single-line commands, or undefined when empty.
// SECURITY: each command is written to the pty verbatim (`pty.write(`${cmd}\r`)`), so every element is
// forced single-line; the array length is capped.
function commandList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .filter((x): x is string => typeof x === 'string')
    .map(oneCommand)
    .filter((s) => s.length > 0)
    .slice(0, MAX_COMMANDS);
  return out.length > 0 ? out : undefined;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.length > 0 ? v : fallback;

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

// Migrate the old built-in theme name to its current name (keeps a pre-existing settings.json valid).
const migrateTheme = (theme: string): string => (theme === 'JetBrains Dark' ? 'Dark' : theme);

const statusColorRecord = (v: unknown): Record<StatusState, string> => {
  const o = isObj(v) ? v : {};
  return Object.fromEntries(STATUS_STATES.map((s) => [s, hexColor(o[s])])) as Record<StatusState, string>;
};
const statusAnimRecord = (v: unknown): Record<StatusState, StatusAnim | ''> => {
  const o = isObj(v) ? v : {};
  return Object.fromEntries(
    STATUS_STATES.map((s) => [s, o[s] === 'pulse' || o[s] === 'static' ? o[s] : '']),
  ) as Record<StatusState, StatusAnim | ''>;
};
// A profile's optional status override — only well-formed, non-default fields are kept; '' overall → undefined.
function normalizeProfileStatus(v: unknown): ProfileStatus | undefined {
  if (!isObj(v)) return undefined;
  const out: ProfileStatus = {};
  if (typeof v.enabled === 'boolean') out.enabled = v.enabled;
  const colorsIn = isObj(v.colors) ? v.colors : {};
  const colors: Partial<Record<StatusState, string>> = {};
  for (const s of STATUS_STATES) {
    const h = hexColor(colorsIn[s]);
    if (h) colors[s] = h;
  }
  if (Object.keys(colors).length) out.colors = colors;
  const animsIn = isObj(v.animations) ? v.animations : {};
  const animations: Partial<Record<StatusState, StatusAnim>> = {};
  for (const s of STATUS_STATES) {
    if (animsIn[s] === 'pulse' || animsIn[s] === 'static') animations[s] = animsIn[s] as StatusAnim;
  }
  if (Object.keys(animations).length) out.animations = animations;
  return Object.keys(out).length ? out : undefined;
}

// A #hex colour or '' (meaning "use the theme default"). Anything else → ''. This is a trust boundary:
// the value is written into a CSS custom property, so only a strict hex passes. A 3-digit #rgb is
// expanded to #rrggbb so stored values are always 6-digit (the native colour picker only does #rrggbb).
const hexColor = (v: unknown): string => {
  if (typeof v !== 'string') return '';
  const h = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(v)?.[1];
  if (!h) return '';
  return h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`;
};

const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

const int = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : fallback;

const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback;

// Coerce a font weight onto the CSS 100–900 scale, snapped to the nearest 100 (xterm/CSS steps).
const weight = (v: unknown, fallback: number): number =>
  Math.round(num(v, fallback, FONT_WEIGHT_MIN, FONT_WEIGHT_MAX) / 100) * 100;

// Coerce one entry of `profiles`. Returns null for anything that isn't a well-formed profile (so
// it can be filtered out). Builds a fresh object, so unknown keys are dropped.
function normalizeProfile(v: unknown): UserProfile | null {
  if (!isObj(v)) return null;
  const id = typeof v.id === 'string' ? v.id : '';
  const baseShellId = typeof v.baseShellId === 'string' ? v.baseShellId : '';
  if (!id || !baseShellId) return null; // a stable id + a base shell are required to launch
  const profile: UserProfile = {
    id,
    name: typeof v.name === 'string' ? v.name : '',
    baseShellId,
  };
  // Startup sequence: the new `startupCommands` array, or a legacy single `startupCommand` folded in.
  const startupCommands = commandList(v.startupCommands) ?? (typeof v.startupCommand === 'string' ? commandList([v.startupCommand]) : undefined);
  if (startupCommands) profile.startupCommands = startupCommands;
  const restoreCommands = commandList(v.restoreCommands);
  if (restoreCommands) profile.restoreCommands = restoreCommands;
  const status = normalizeProfileStatus(v.status);
  if (status) profile.status = status;
  return profile;
}

/**
 * Coerce/clamp an untrusted parsed config onto the schema, filling gaps from DEFAULTS.
 *
 * The single trust boundary for settings.json: every field is type-checked and clamped, malformed
 * profiles are dropped, `startupCommand` is forced single-line, unknown keys are stripped, and the
 * result is always a valid `Settings`. Never throws.
 */
export function normalize(input: unknown): Settings {
  const root = isObj(input) ? input : {};
  const appearance = isObj(root.appearance) ? root.appearance : {};
  const font = isObj(root.font) ? root.font : {};
  const terminal = isObj(root.terminal) ? root.terminal : {};
  return {
    schemaVersion: int(root.schemaVersion, DEFAULTS.schemaVersion, 1, Number.MAX_SAFE_INTEGER),
    appearance: {
      theme: migrateTheme(str(appearance.theme, DEFAULTS.appearance.theme)),
      followOS: bool(appearance.followOS, DEFAULTS.appearance.followOS),
      reduceMotion: bool(appearance.reduceMotion, DEFAULTS.appearance.reduceMotion),
      focusBorderColor: hexColor(appearance.focusBorderColor),
      statusColors: statusColorRecord(appearance.statusColors),
      statusAnimations: statusAnimRecord(appearance.statusAnimations),
    },
    font: {
      family: str(font.family, DEFAULTS.font.family),
      size: num(font.size, DEFAULTS.font.size, FONT_SIZE_MIN, FONT_SIZE_MAX),
    },
    terminal: {
      scrollback: int(terminal.scrollback, DEFAULTS.terminal.scrollback, SCROLLBACK_MIN, SCROLLBACK_MAX),
      cursorStyle: oneOf(terminal.cursorStyle, CURSOR_STYLES, DEFAULTS.terminal.cursorStyle),
      cursorInactiveStyle: oneOf(terminal.cursorInactiveStyle, CURSOR_INACTIVE_STYLES, DEFAULTS.terminal.cursorInactiveStyle),
      cursorBlink: bool(terminal.cursorBlink, DEFAULTS.terminal.cursorBlink),
      lineHeight: num(terminal.lineHeight, DEFAULTS.terminal.lineHeight, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX),
      letterSpacing: num(terminal.letterSpacing, DEFAULTS.terminal.letterSpacing, LETTER_SPACING_MIN, LETTER_SPACING_MAX),
      fontWeight: weight(terminal.fontWeight, DEFAULTS.terminal.fontWeight),
      shellIntegration: bool(terminal.shellIntegration, DEFAULTS.terminal.shellIntegration),
      webgl: bool(terminal.webgl, DEFAULTS.terminal.webgl),
    },
    profiles: Array.isArray(root.profiles)
      ? root.profiles.map(normalizeProfile).filter((p): p is UserProfile => p !== null)
      : [],
    // '' = no default (OS shell). Stored as-is (cross-checked against live profiles at launch time),
    // bounded so a garbage value can't bloat the file.
    defaultProfileId: typeof root.defaultProfileId === 'string' ? root.defaultProfileId.slice(0, 200) : '',
    restoreSession: bool(root.restoreSession, DEFAULTS.restoreSession),
    restoreScrollback: bool(root.restoreScrollback, DEFAULTS.restoreScrollback),
    restorePathOnly: bool(root.restorePathOnly, DEFAULTS.restorePathOnly),
    // Each action gets a valid canonical chord: the stored one if it parses, else the default. Unknown
    // keys are dropped (only the known actions are emitted).
    keybindings: Object.fromEntries(
      KEYBINDINGS.map((a) => [a, normalizeChord(isObj(root.keybindings) ? root.keybindings[a] : undefined) ?? DEFAULT_KEYBINDINGS[a]]),
    ) as Record<ActionId, string>,
  };
}
