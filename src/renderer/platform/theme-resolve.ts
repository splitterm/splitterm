// Pure mapping from appearance settings (+ the OS color preference, when following) to the
// `<html data-theme>` value. '' = the :root default (Dark). OLED Black is manual-only:
// followOS never selects it — it only flips between Dark and Light. Kept DOM-free so
// it's unit-testable.
import type { Settings } from '@shared/domain/settings.schema';

export type ThemeAttr = '' | 'oled' | 'light';

export function resolveThemeAttr(
  appearance: Pick<Settings['appearance'], 'theme' | 'followOS'>,
  prefersDark: boolean,
): ThemeAttr {
  if (appearance.followOS) return prefersDark ? '' : 'light';
  switch (appearance.theme) {
    case 'OLED Black':
      return 'oled';
    case 'Light':
      return 'light';
    default:
      return '';
  }
}
