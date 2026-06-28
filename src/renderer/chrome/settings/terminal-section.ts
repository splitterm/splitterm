// Terminal settings: font + cursor + scrollback. Changes write through immediately and the
// settings-controller pushes them onto every live xterm (and new terminals read them on spawn).
import { ipc } from '@platform/ipc-client';
import type { Settings } from '@shared/domain/settings.schema';
import { numberControl, row, sectionHeading, selectControl, textControl, toggle } from './controls';

type CursorStyle = Settings['terminal']['cursorStyle'];
type InactiveCursorStyle = Settings['terminal']['cursorInactiveStyle'];

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
    row(
      'Font weight',
      selectControl({
        value: String(local.terminal.fontWeight),
        options: [
          { value: '300', label: 'Light' },
          { value: '400', label: 'Normal' },
          { value: '500', label: 'Medium' },
          { value: '600', label: 'Semibold' },
          { value: '700', label: 'Bold' },
        ],
        onChange: (v) => {
          local.terminal.fontWeight = Number(v);
          saveTerm();
        },
      }),
    ),
    row(
      'Line height',
      numberControl({
        value: local.terminal.lineHeight,
        min: 1,
        max: 2,
        step: 0.1,
        onChange: (v) => {
          local.terminal.lineHeight = v;
          saveTerm();
        },
      }),
      'Multiple of the font size (1.0 = tight).',
    ),
    row(
      'Letter spacing',
      numberControl({
        value: local.terminal.letterSpacing,
        min: -5,
        max: 10,
        step: 0.5,
        onChange: (v) => {
          local.terminal.letterSpacing = v;
          saveTerm();
        },
      }),
      'Extra horizontal space between cells, in pixels.',
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
    row(
      'Inactive cursor',
      selectControl({
        value: local.terminal.cursorInactiveStyle,
        options: [
          { value: 'outline', label: 'Outline' },
          { value: 'block', label: 'Block' },
          { value: 'bar', label: 'Bar' },
          { value: 'underline', label: 'Underline' },
          { value: 'none', label: 'Hidden' },
        ],
        onChange: (v) => {
          local.terminal.cursorInactiveStyle = v as InactiveCursorStyle;
          saveTerm();
        },
      }),
      'How the cursor looks when the pane is not focused.',
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
    sectionHeading('Integration'),
    row(
      'Shell integration',
      toggle({
        checked: local.terminal.shellIntegration,
        onChange: (v) => {
          local.terminal.shellIntegration = v;
          saveTerm();
        },
      }),
      'Report the working directory from PowerShell (OSC 7) so a split opens in the same folder. Applies to new terminals.',
    ),
    sectionHeading('Rendering'),
    row(
      'GPU acceleration',
      toggle({
        checked: local.terminal.webgl,
        onChange: (v) => {
          local.terminal.webgl = v;
          saveTerm();
        },
      }),
      'Render terminals on the GPU (WebGL) for smoother output under heavy load. Falls back to the standard renderer when unavailable. Applies to new terminals.',
    ),
  );
  return el;
}
