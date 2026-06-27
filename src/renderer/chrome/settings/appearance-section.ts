// Appearance settings: theme, OS sync, reduce motion. Changes write through immediately and are
// applied live by the renderer settings-controller (which flips <html data-theme> + motion tokens).
import { ipc } from '@platform/ipc-client';
import type { Settings, ThemeName } from '@shared/domain/settings.schema';
import { row, sectionHeading, selectControl, toggle } from './controls';

export function createAppearanceSection(initial: Settings): HTMLElement {
  const local = structuredClone(initial);
  const save = (): void => void ipc.settings.set({ appearance: { ...local.appearance } });

  const el = document.createElement('div');
  el.className = 'flex flex-col';

  const themeSelect = selectControl({
    value: local.appearance.theme,
    disabled: local.appearance.followOS,
    options: [
      { value: 'JetBrains Dark', label: 'JetBrains Dark' },
      { value: 'OLED Black', label: 'OLED Black' },
      { value: 'Light', label: 'Light' },
    ],
    onChange: (v) => {
      local.appearance.theme = v as ThemeName;
      save();
    },
  });

  const followToggle = toggle({
    checked: local.appearance.followOS,
    onChange: (v) => {
      local.appearance.followOS = v;
      themeSelect.disabled = v; // OS sync owns the dark/light choice
      save();
    },
  });

  const motionToggle = toggle({
    checked: local.appearance.reduceMotion,
    onChange: (v) => {
      local.appearance.reduceMotion = v;
      save();
    },
  });

  el.append(
    sectionHeading('Theme'),
    row('Sync with OS', followToggle, 'Match the system, switching between JetBrains Dark and Light.'),
    row('Theme', themeSelect, 'OLED Black (true black) is manual-only — turn off OS sync to pick it.'),
    sectionHeading('Motion'),
    row('Reduce motion', motionToggle, 'Disable split/close/drawer animations and transitions.'),
  );
  return el;
}
