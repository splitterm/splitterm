// Renderer-side settings: the single place that fetches the snapshot, applies appearance
// (theme + reduce-motion) to the document, keeps live terminals in sync, and exposes the current
// values for newly-created terminals. Main owns the file; this reflects it into the live UI.
import type { Settings } from '@shared/domain/settings.schema';
import { DEFAULTS } from '@shared/domain/settings.schema';
import { ipc } from './ipc-client';
import { allPanes } from './pane-registry';
import { resolveThemeAttr } from './theme-resolve';

let current: Settings = DEFAULTS;

/** The latest settings snapshot — read synchronously when creating a terminal. */
export function getSettings(): Settings {
  return current;
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function applyAppearance(s: Settings): void {
  const html = document.documentElement;
  const attr = resolveThemeAttr(s.appearance, darkQuery.matches);
  if (attr) html.dataset.theme = attr;
  else delete html.dataset.theme;
  if (s.appearance.reduceMotion) html.dataset.reduceMotion = 'true';
  else delete html.dataset.reduceMotion;
}

function applyToTerminals(s: Settings): void {
  for (const pane of allPanes()) pane.applySettings(s);
}

/** Fetch the initial snapshot, apply it, and keep applying on changes. Call once at startup. */
export async function initSettings(): Promise<void> {
  current = await ipc.settings.get().catch(() => DEFAULTS);
  applyAppearance(current);
  // Re-apply when the OS color scheme flips (only matters while followOS is on).
  darkQuery.addEventListener('change', () => {
    if (!current.appearance.followOS) return;
    applyAppearance(current);
    applyToTerminals(current);
  });
  ipc.settings.onChange((s) => {
    current = s;
    applyAppearance(s); // data-theme first so terminals re-read the updated CSS vars
    applyToTerminals(s);
  });
}
