// Profiles settings: pick which shell/profile the "+" button opens by default, and create launchers
// (a base shell + optional startup command + name) that show up in the new-terminal ▾ menu, spawn
// with that name as the title, and run the command on launch.
import { Trash2 } from 'lucide';
import { icon } from '../icons';
import { ipc } from '@platform/ipc-client';
import type { Settings } from '@shared/domain/settings.schema';
import type { UserProfile } from '@shared/domain/profile';
import type { ShellProfile } from '@shared/ipc';
import { FIELD, row, sectionHeading, selectControl, textControl, textareaControl } from './controls';

/** Split a textarea's lines into a trimmed command list, or undefined when empty. */
function linesToCommands(text: string): string[] | undefined {
  const out = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  return out.length > 0 ? out : undefined;
}

export function createProfilesSection(initial: Settings, shells: ShellProfile[]): HTMLElement {
  let profiles = structuredClone(initial.profiles);
  let currentDefault = initial.defaultProfileId; // which profile the "+" opens ('' = OS shell)

  const el = document.createElement('div');
  el.className = 'flex flex-col gap-2';

  // ---- default-profile picker: the shell/profile the "+" button launches ----
  const defaultHost = document.createElement('div');
  const defaultOptions = (): { value: string; label: string }[] => [
    { value: '', label: 'OS default shell' },
    ...shells.map((s) => ({ value: s.id, label: s.label })),
    ...profiles.map((p) => ({ value: p.id, label: p.name || 'Untitled profile' })),
  ];
  function renderDefault(): void {
    // Rebuilt whenever the profile list changes so the just-added/removed profile is (de)selectable.
    const sel = selectControl({
      value: currentDefault,
      options: defaultOptions(),
      onChange: (v) => {
        currentDefault = v;
        void ipc.settings.set({ defaultProfileId: v });
      },
    });
    sel.setAttribute('aria-label', 'Default profile for the new-terminal button');
    defaultHost.replaceChildren(sel);
  }

  const help = document.createElement('div');
  help.className = 'text-[11px] leading-snug text-[var(--text-disabled)]';
  help.textContent =
    'Each profile appears in the new-terminal ▾ menu. Startup commands run on a fresh terminal; ' +
    'restore commands run instead when the session reopens — e.g. startup "claude", restore "claude --continue". ' +
    'If a command opens an interactive program (like claude), put it last — anything after it is typed into that program.';

  const list = document.createElement('div');
  list.className = 'flex flex-col gap-1';

  // ---- add form ----
  const form = document.createElement('form');
  form.className = 'flex flex-col gap-2 pt-1';
  const nameInput = textControl({ value: '', placeholder: 'Name (e.g. Claude)', onChange: () => {} });
  nameInput.classList.remove('min-w-[240px]');
  nameInput.setAttribute('aria-label', 'Profile name');
  const shellSelect = document.createElement('select');
  shellSelect.className = FIELD + ' cursor-pointer';
  shellSelect.setAttribute('aria-label', 'Base shell');
  for (const s of shells) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.label;
    shellSelect.append(opt);
  }
  const startupArea = textareaControl({ value: '', placeholder: 'Startup commands — one per line (e.g. claude)', onChange: () => {} });
  startupArea.setAttribute('aria-label', 'Startup commands');
  const restoreArea = textareaControl({
    value: '',
    placeholder: 'On restore — one per line (e.g. claude --continue); blank = same as startup',
    onChange: () => {},
  });
  restoreArea.setAttribute('aria-label', 'Restore commands');
  const addBtn = document.createElement('button');
  addBtn.type = 'submit';
  addBtn.className =
    'h-7 rounded-[var(--r-sm)] bg-[var(--accent)] text-[var(--accent-text)] text-[12px] font-medium ' +
    'cursor-pointer hover:bg-[var(--accent-hover)] transition-colors ease-[var(--ease-out)] duration-[var(--motion-fast)]';
  addBtn.textContent = 'Add profile';
  form.append(nameInput, shellSelect, startupArea, restoreArea, addBtn);

  function renderList(): void {
    if (profiles.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'text-[11px] text-[var(--text-disabled)] py-1';
      empty.textContent = 'No profiles yet.';
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...profiles.map(renderRow));
  }

  function renderRow(p: UserProfile): HTMLElement {
    const rowEl = document.createElement('div');
    rowEl.className = 'group flex items-center gap-2 px-2 h-9 rounded-[var(--r-sm)] hover:bg-[var(--bg-hover)]';
    const text = document.createElement('div');
    text.className = 'flex-1 min-w-0';
    const name = document.createElement('div');
    name.className = 'text-[12px] text-[var(--text-primary)] truncate';
    name.textContent = p.name;
    const sub = document.createElement('div');
    sub.className = 'text-[10px] text-[var(--text-disabled)] truncate';
    const shellLabel = shells.find((s) => s.id === p.baseShellId)?.label ?? p.baseShellId;
    const startup = p.startupCommands?.join('; ');
    const restore = p.restoreCommands?.join('; ');
    sub.textContent = shellLabel + (startup ? ` · ${startup}` : '') + (restore ? ` · ⟳ ${restore}` : '');
    text.append(name, sub);
    const del = document.createElement('button');
    del.type = 'button';
    del.title = 'Delete profile';
    del.className =
      'shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-[var(--r-sm)] cursor-pointer ' +
      'opacity-0 group-hover:opacity-100 text-[var(--text-secondary)] hover:bg-[var(--bg-active)] hover:text-[var(--danger)]';
    del.appendChild(icon(Trash2, 13));
    del.addEventListener('click', () => void removeProfile(p.id));
    rowEl.append(text, del);
    return rowEl;
  }

  async function addProfile(): Promise<void> {
    const name = nameInput.value.trim();
    const baseShellId = shellSelect.value;
    if (!name || !baseShellId) return;
    const profile: UserProfile = { id: crypto.randomUUID(), name, baseShellId };
    const startupCommands = linesToCommands(startupArea.value);
    if (startupCommands) profile.startupCommands = startupCommands;
    const restoreCommands = linesToCommands(restoreArea.value);
    if (restoreCommands) profile.restoreCommands = restoreCommands;
    profiles = [...profiles, profile];
    await ipc.settings.set({ profiles });
    nameInput.value = '';
    startupArea.value = '';
    restoreArea.value = '';
    renderList();
    renderDefault(); // the new profile is now selectable as the "+" default
  }

  async function removeProfile(id: string): Promise<void> {
    profiles = profiles.filter((p) => p.id !== id);
    const patch: Partial<Settings> = { profiles };
    // If this profile was the "+" default, clear the dangling reference in the same write (otherwise
    // defaultProfileId keeps pointing at a now-missing id and "+" silently falls back to the OS shell).
    if (id === currentDefault) {
      patch.defaultProfileId = '';
      currentDefault = '';
    }
    await ipc.settings.set(patch);
    renderList();
    renderDefault();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void addProfile();
  });

  renderList();
  renderDefault();
  el.append(
    sectionHeading('Default'),
    row('New terminal opens', defaultHost, 'Which shell or profile the + button launches.'),
    sectionHeading('Profiles'),
    help,
    list,
    form,
  );
  return el;
}
