import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DEFAULTS, normalize, type Settings } from '@shared/domain/settings.schema';

// Single human-editable settings.json in userData. Read once on boot, written atomically + debounced.
// The file is untrusted, so both reads (boot) and writes (renderer patches) pass through
// normalize() — the single trust boundary that coerces/clamps every field and fills gaps from
// DEFAULTS, so `current` is always a valid Settings no matter what's on disk or in a patch.
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
    current = normalize(JSON.parse(await fs.readFile(filePath(), 'utf8')));
  } catch {
    current = DEFAULTS; // missing or corrupt → defaults
  }
  return current;
}

export function getSettings(): Settings {
  return current;
}

export function setSettings(patch: Partial<Settings>): Settings {
  // Deep-merge the partial patch, then re-normalize so a renderer-supplied value (e.g. a profile
  // with a multi-line startupCommand) is clamped before it's persisted or synced to the host.
  current = normalize(merge(current, patch));
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
