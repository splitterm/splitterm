// Settings type + DEFAULTS + normalize(). Pure data, shared by main (owns the file) and
// the renderer (reads a snapshot). settings.json is UNTRUSTED input: normalize() is the single
// trust boundary that coerces/clamps every field onto the schema before any process consumes it.

import type { UserProfile } from './profile';

export type ThemeName = 'JetBrains Dark' | 'OLED Black' | 'Light' | (string & {});

export interface Settings {
  schemaVersion: number;
  appearance: {
    /** active theme by name (or a user scheme) */
    theme: ThemeName;
    /** auto-switch between "JetBrains Dark" (OS dark) and "Light" (OS light) */
    followOS: boolean;
    /** collapse motion tokens to 0ms (also honors prefers-reduced-motion) */
    reduceMotion: boolean;
  };
  font: {
    family: string;
    size: number;
  };
  terminal: {
    scrollback: number;
    cursorStyle: 'block' | 'bar' | 'underline';
    cursorBlink: boolean;
  };
  /** user-defined launch profiles, shown in the new-terminal dropdown */
  profiles: UserProfile[];
  /** id of the profile the "+" button opens (detected shell or user profile); '' = OS default shell */
  defaultProfileId: string;
}

export const DEFAULTS: Settings = {
  schemaVersion: 1,
  appearance: { theme: 'JetBrains Dark', followOS: true, reduceMotion: false },
  font: { family: 'JetBrains Mono, Cascadia Code, ui-monospace, monospace', size: 13 },
  terminal: { scrollback: 1000, cursorStyle: 'block', cursorBlink: true },
  profiles: [],
  defaultProfileId: '',
};

// Clamp ranges for numeric fields. Bounds are defensive — wide enough to honor any sane user value,
// tight enough to keep garbage (NaN, negatives, absurd sizes) out of `new Terminal({...})`.
const FONT_SIZE_MIN = 6;
const FONT_SIZE_MAX = 72;
const SCROLLBACK_MIN = 0;
const SCROLLBACK_MAX = 1_000_000;
const STARTUP_COMMAND_MAX = 2000;
const CURSOR_STYLES = ['block', 'bar', 'underline'] as const;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.length > 0 ? v : fallback;

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

const int = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : fallback;

const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback;

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
  if (typeof v.startupCommand === 'string') {
    // SECURITY: the host runs this verbatim (`pty.write(`${cmd}\r`)`), so it MUST be a single line —
    // an embedded newline would inject a second command. Keep only the first line, bounded length.
    const firstLine = v.startupCommand.split(/[\r\n]/, 1)[0] ?? '';
    const cmd = firstLine.slice(0, STARTUP_COMMAND_MAX);
    if (cmd) profile.startupCommand = cmd;
  }
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
      theme: str(appearance.theme, DEFAULTS.appearance.theme),
      followOS: bool(appearance.followOS, DEFAULTS.appearance.followOS),
      reduceMotion: bool(appearance.reduceMotion, DEFAULTS.appearance.reduceMotion),
    },
    font: {
      family: str(font.family, DEFAULTS.font.family),
      size: num(font.size, DEFAULTS.font.size, FONT_SIZE_MIN, FONT_SIZE_MAX),
    },
    terminal: {
      scrollback: int(terminal.scrollback, DEFAULTS.terminal.scrollback, SCROLLBACK_MIN, SCROLLBACK_MAX),
      cursorStyle: oneOf(terminal.cursorStyle, CURSOR_STYLES, DEFAULTS.terminal.cursorStyle),
      cursorBlink: bool(terminal.cursorBlink, DEFAULTS.terminal.cursorBlink),
    },
    profiles: Array.isArray(root.profiles)
      ? root.profiles.map(normalizeProfile).filter((p): p is UserProfile => p !== null)
      : [],
    // '' = no default (OS shell). Stored as-is (cross-checked against live profiles at launch time),
    // bounded so a garbage value can't bloat the file.
    defaultProfileId: typeof root.defaultProfileId === 'string' ? root.defaultProfileId.slice(0, 200) : '',
  };
}
