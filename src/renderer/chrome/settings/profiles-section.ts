// Profiles settings: create launchers (a base shell + optional startup command + name) that show
// up in the new-terminal ▾ menu, spawn with that name as the title, and run the command on launch.
import { Trash2 } from 'lucide';
import { icon } from '../icons';
import { ipc } from '@platform/ipc-client';
import type { Settings } from '@shared/domain/settings.schema';
import type { UserProfile } from '@shared/domain/profile';
import type { ShellProfile } from '@shared/ipc';
import { FIELD, sectionHeading, textControl } from './controls';

export function createProfilesSection(initial: Settings, shells: ShellProfile[]): HTMLElement {
  let profiles = structuredClone(initial.profiles);

  const el = document.createElement('div');
  el.className = 'flex flex-col gap-2';

  const help = document.createElement('div');
  help.className = 'text-[11px] leading-snug text-[var(--text-disabled)]';
  help.textContent =
    'Each profile appears in the new-terminal ▾ menu. Example: "Claude" on PowerShell with the ' +
    'startup command "claude".';

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
  const cmdInput = textControl({ value: '', placeholder: 'Startup command (optional, e.g. claude)', onChange: () => {} });
  cmdInput.classList.remove('min-w-[240px]');
  cmdInput.setAttribute('aria-label', 'Startup command');
  const addBtn = document.createElement('button');
  addBtn.type = 'submit';
  addBtn.className =
    'h-7 rounded-[var(--r-sm)] bg-[var(--accent)] text-[var(--accent-text)] text-[12px] font-medium ' +
    'cursor-pointer hover:bg-[var(--accent-hover)] transition-colors ease-[var(--ease-out)] duration-[var(--motion-fast)]';
  addBtn.textContent = 'Add profile';
  form.append(nameInput, shellSelect, cmdInput, addBtn);

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
    sub.textContent = shellLabel + (p.startupCommand ? ` · ${p.startupCommand}` : '');
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
    const startupCommand = cmdInput.value.trim() || undefined;
    profiles = [...profiles, { id: crypto.randomUUID(), name, baseShellId, startupCommand }];
    await ipc.settings.set({ profiles });
    nameInput.value = '';
    cmdInput.value = '';
    renderList();
  }

  async function removeProfile(id: string): Promise<void> {
    profiles = profiles.filter((p) => p.id !== id);
    const patch: Partial<Settings> = { profiles };
    // If this profile was the "+" default, clear the dangling reference atomically with the delete
    // (otherwise defaultProfileId keeps pointing at a now-missing id and "+" silently falls back).
    if (id === initial.defaultProfileId) patch.defaultProfileId = '';
    await ipc.settings.set(patch);
    renderList();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void addProfile();
  });

  renderList();
  el.append(sectionHeading('Profiles'), help, list, form);
  return el;
}
