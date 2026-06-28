// Keyboard settings: rebind the tiling shortcuts. Each row captures a chord by focus — click the
// button, press a shortcut, and it's saved live; clicking away cancels. A chord already bound to a
// different action is rejected with an inline note (no silent steal). "Reset" restores the defaults.
import { ipc } from '@platform/ipc-client';
import type { Settings } from '@shared/domain/settings.schema';
import {
  KEYBINDINGS,
  ACTION_LABELS,
  DEFAULT_KEYBINDINGS,
  formatChord,
  chordFromEvent,
  normalizeChord,
  matchAction,
  type ActionId,
} from '@shared/domain/keymap';
import { FIELD, row, sectionHeading } from './controls';

export function createKeyboardSection(initial: Settings): HTMLElement {
  const local: Record<ActionId, string> = { ...initial.keybindings };
  const repaint = new Map<ActionId, () => void>();

  const save = (): void => void ipc.settings.set({ keybindings: { ...local } });

  const el = document.createElement('div');
  el.className = 'flex flex-col';

  function chordControl(action: ActionId): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'flex items-center gap-2 shrink-0';
    const warn = document.createElement('span');
    warn.className = 'text-[11px] text-[var(--danger)] hidden';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', `${ACTION_LABELS[action]} shortcut`);
    btn.className = FIELD + ' min-w-[150px] cursor-pointer text-left font-mono';
    wrap.append(warn, btn);

    let capturing = false;
    const paint = (): void => {
      btn.textContent = formatChord(local[action]);
    };
    paint();
    repaint.set(action, () => {
      capturing = false;
      warn.classList.add('hidden');
      paint();
    });

    btn.addEventListener('keydown', (e) => {
      if (!capturing) return;
      e.preventDefault();
      e.stopPropagation(); // beat the dialog Tab-trap; window-capture Esc already handled before here
      const raw = chordFromEvent(e);
      if (!raw) return; // bare modifier — keep waiting for the full chord
      const chord = normalizeChord(raw);
      if (!chord) {
        // a bare ordinary key (or unsupported code) — needs a modifier; stay in capture mode
        warn.textContent = 'Needs a modifier';
        warn.classList.remove('hidden');
        return;
      }
      const existing = matchAction(chord, local);
      if (existing && existing !== action) {
        warn.textContent = `In use: ${ACTION_LABELS[existing]}`;
        warn.classList.remove('hidden');
      } else {
        local[action] = chord;
        warn.classList.add('hidden');
        save();
      }
      capturing = false;
      paint();
    });
    btn.addEventListener('blur', () => {
      warn.classList.add('hidden'); // clear any conflict / needs-modifier note when leaving
      if (!capturing) return;
      capturing = false; // clicked / focused away → cancel
      paint();
    });
    btn.addEventListener('click', () => {
      if (capturing) return;
      capturing = true;
      warn.classList.add('hidden');
      btn.textContent = 'Press a shortcut… (click away to cancel)';
    });
    return wrap;
  }

  el.append(sectionHeading('Shortcuts'));
  for (const action of KEYBINDINGS) {
    el.append(row(ACTION_LABELS[action], chordControl(action)));
  }

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset to defaults';
  reset.className =
    'self-start mt-3 h-7 px-2.5 rounded-[var(--r-sm)] border border-[var(--border)] text-[12px] ' +
    'text-[var(--text-secondary)] cursor-pointer hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] ' +
    'transition-colors ease-[var(--ease-out)] duration-[var(--motion-fast)]';
  reset.addEventListener('click', () => {
    Object.assign(local, DEFAULT_KEYBINDINGS);
    save();
    for (const action of KEYBINDINGS) repaint.get(action)?.();
  });
  el.append(reset);

  return el;
}
