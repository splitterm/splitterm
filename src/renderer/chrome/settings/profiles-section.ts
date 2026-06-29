// Profiles settings: pick which shell/profile the "+" button opens by default, and create launchers
// (a base shell + optional startup command + name) that show up in the new-terminal ▾ menu, spawn
// with that name as the title, and run the command on launch.
import { Trash2, Pencil } from 'lucide';
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
  let editingId: string | null = null; // the profile being edited (the form saves it), or null = add new

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
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.hidden = true;
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className =
    'h-7 px-3 rounded-[var(--r-sm)] border border-[var(--border)] text-[12px] cursor-pointer ' +
    'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]';
  cancelBtn.addEventListener('click', () => resetForm());
  const buttons = document.createElement('div');
  buttons.className = 'flex gap-2';
  addBtn.classList.add('px-3');
  buttons.append(addBtn, cancelBtn);
  form.append(nameInput, shellSelect, startupArea, restoreArea, buttons);

  const clearTransientShell = (): void => shellSelect.querySelectorAll('option[data-transient]').forEach((o) => o.remove());

  // Switch the form between "add" and "edit a profile" modes.
  function resetForm(): void {
    editingId = null;
    nameInput.value = '';
    clearTransientShell();
    shellSelect.selectedIndex = 0;
    startupArea.value = '';
    restoreArea.value = '';
    addBtn.textContent = 'Add profile';
    cancelBtn.hidden = true;
  }
  function startEdit(p: UserProfile): void {
    editingId = p.id;
    nameInput.value = p.name;
    // If the profile's base shell is no longer detected, add a transient option so the id round-trips —
    // otherwise the <select> falls back to '' and saveProfile's required-field guard silently no-ops.
    clearTransientShell();
    shellSelect.value = p.baseShellId;
    if (shellSelect.value !== p.baseShellId) {
      const opt = document.createElement('option');
      opt.value = p.baseShellId;
      opt.textContent = `${p.baseShellId} (not detected)`;
      opt.dataset.transient = 'true';
      shellSelect.append(opt);
      shellSelect.value = p.baseShellId;
    }
    startupArea.value = (p.startupCommands ?? []).join('\n');
    restoreArea.value = (p.restoreCommands ?? []).join('\n');
    addBtn.textContent = 'Save changes';
    cancelBtn.hidden = false;
    nameInput.focus();
  }

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
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.title = 'Edit profile';
    edit.className =
      'shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-[var(--r-sm)] cursor-pointer ' +
      'opacity-0 group-hover:opacity-100 text-[var(--text-secondary)] hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)]';
    edit.appendChild(icon(Pencil, 13));
    edit.addEventListener('click', () => startEdit(p));
    rowEl.append(text, edit, del);
    return rowEl;
  }

  async function saveProfile(): Promise<void> {
    const name = nameInput.value.trim();
    const baseShellId = shellSelect.value;
    if (!name || !baseShellId) return;
    // Keep the id when editing so the "+" default + any saved session referencing it stay valid.
    const profile: UserProfile = { id: editingId ?? crypto.randomUUID(), name, baseShellId };
    const startupCommands = linesToCommands(startupArea.value);
    if (startupCommands) profile.startupCommands = startupCommands;
    const restoreCommands = linesToCommands(restoreArea.value);
    if (restoreCommands) profile.restoreCommands = restoreCommands;
    profiles = editingId ? profiles.map((p) => (p.id === editingId ? profile : p)) : [...profiles, profile];
    await ipc.settings.set({ profiles });
    resetForm();
    renderList();
    renderDefault(); // the new/renamed profile is selectable as the "+" default
  }

  async function removeProfile(id: string): Promise<void> {
    profiles = profiles.filter((p) => p.id !== id);
    if (id === editingId) resetForm(); // don't keep editing a profile that no longer exists
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
    void saveProfile();
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
