// Terminal settings: font + cursor + scrollback. Changes write through immediately and the
// settings-controller pushes them onto every live xterm (and new terminals read them on spawn).
import { ipc } from '@platform/ipc-client';
import type { Settings } from '@shared/domain/settings.schema';
import { numberControl, row, sectionHeading, selectControl, textControl, toggle } from './controls';

type CursorStyle = Settings['terminal']['cursorStyle'];

export function createTerminalSection(initial: Settings): HTMLElement {
  const local = structuredClone(initial);
  const saveFont = (): void => void ipc.settings.set({ font: { ...local.font } });
  const saveTerm = (): void => void ipc.settings.set({ terminal: { ...local.terminal } });

  const el = document.createElement('div');
  el.className = 'flex flex-col';

  el.append(
    sectionHeading('Font'),
    row(
      'Font family',
      textControl({
        value: local.font.family,
        placeholder: 'JetBrains Mono, monospace',
        onChange: (v) => {
          local.font.family = v.trim() || local.font.family;
          saveFont();
        },
      }),
    ),
    row(
      'Font size',
      numberControl({
        value: local.font.size,
        min: 8,
        max: 32,
        step: 1,
        onChange: (v) => {
          local.font.size = v;
          saveFont();
        },
      }),
    ),
    sectionHeading('Cursor'),
    row(
      'Cursor style',
      selectControl({
        value: local.terminal.cursorStyle,
        options: [
          { value: 'block', label: 'Block' },
          { value: 'bar', label: 'Bar' },
          { value: 'underline', label: 'Underline' },
        ],
        onChange: (v) => {
          local.terminal.cursorStyle = v as CursorStyle;
          saveTerm();
        },
      }),
    ),
    row(
      'Cursor blink',
      toggle({
        checked: local.terminal.cursorBlink,
        onChange: (v) => {
          local.terminal.cursorBlink = v;
          saveTerm();
        },
      }),
    ),
    sectionHeading('Buffer'),
    row(
      'Scrollback',
      numberControl({
        value: local.terminal.scrollback,
        min: 0,
        max: 100000,
        step: 100,
        onChange: (v) => {
          local.terminal.scrollback = v;
          saveTerm();
        },
      }),
      'Lines of history kept per terminal.',
    ),
  );
  return el;
}
