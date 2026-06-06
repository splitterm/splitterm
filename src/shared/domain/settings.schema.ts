// Settings type + DEFAULTS + normalize(). Pure data, shared by main (owns the file) and
// the renderer (reads a snapshot). Persist only the diff vs DEFAULTS; deep-merge at load.
// profiles + keybindings land in M3 — keep this lean for the scaffold.

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
}

export const DEFAULTS: Settings = {
  schemaVersion: 1,
  appearance: { theme: 'JetBrains Dark', followOS: true, reduceMotion: false },
  font: { family: 'JetBrains Mono, Cascadia Code, ui-monospace, monospace', size: 13 },
  terminal: { scrollback: 1000, cursorStyle: 'block', cursorBlink: true },
  profiles: [],
};

/**
 * Coerce/clamp an untrusted parsed config onto the schema, filling gaps from DEFAULTS.
 * TODO(M3): full deep-merge + per-field clamping + migrations. Scaffold returns DEFAULTS.
 */
export function normalize(_input: unknown): Settings {
  return DEFAULTS;
}
