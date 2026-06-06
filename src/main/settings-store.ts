import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DEFAULTS, type Settings } from '@shared/domain/settings.schema';

// Single human-editable settings.json in userData. Read once on boot (deep-merged over DEFAULTS so
// the file stays minimal and new defaults reach existing users), written atomically + debounced.
let current: Settings = DEFAULTS;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(s: Settings) => void>();

const filePath = (): string => path.join(app.getPath('userData'), 'settings.json');

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// Deep-merge objects; arrays and primitives in `patch` replace those in `base`.
function merge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch) || !isPlainObject(base)) return (patch ?? base) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = isPlainObject(v) && isPlainObject(b) ? merge(b, v) : v;
  }
  return out as T;
}

export async function loadSettings(): Promise<Settings> {
  try {
    current = merge(DEFAULTS, JSON.parse(await fs.readFile(filePath(), 'utf8')));
  } catch {
    current = DEFAULTS; // missing or corrupt → defaults
  }
  return current;
}

export function getSettings(): Settings {
  return current;
}

export function setSettings(patch: Partial<Settings>): Settings {
  current = merge(current, patch);
  scheduleWrite();
  for (const cb of listeners) cb(current);
  return current;
}

export function onSettingsChange(cb: (s: Settings) => void): void {
  listeners.add(cb);
}

function scheduleWrite(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => void writeNow(), 200);
}

async function writeNow(): Promise<void> {
  const target = filePath();
  const tmp = `${target}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(current, null, 2), 'utf8');
    await fs.rename(tmp, target); // atomic on same volume
  } catch {
    /* best effort */
  }
}
