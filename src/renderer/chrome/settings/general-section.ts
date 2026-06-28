// General settings: app-level behavior (startup). Writes through immediately like the other sections.
import { ipc } from '@platform/ipc-client';
import type { Settings } from '@shared/domain/settings.schema';
import { row, sectionHeading, toggle } from './controls';

export function createGeneralSection(initial: Settings): HTMLElement {
  const el = document.createElement('div');
  el.className = 'flex flex-col';
  el.append(
    sectionHeading('Startup'),
    row(
      'Restore previous session',
      toggle({
        checked: initial.restoreSession,
        onChange: (v) => void ipc.settings.set({ restoreSession: v }),
      }),
      'Reopen the previous window layout (with fresh shells) when the app launches.',
    ),
    row(
      'Restore terminal history',
      toggle({
        checked: initial.restoreScrollback,
        onChange: (v) => void ipc.settings.set({ restoreScrollback: v }),
      }),
      'Also replay each terminal’s recent output as read-only history on restore. Saves that output ' +
        'to disk (it may contain secrets), so it’s off by default. Needs “Restore previous session”.',
    ),
  );
  return el;
}
