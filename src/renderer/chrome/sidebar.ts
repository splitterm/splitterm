// Left settings panel (PUSH layout: occupies the body's first grid column, animated open). For now
// it hosts the Profiles manager: create launchers (a base shell + optional startup command + name)
// that appear in the new-terminal ▾ menu. Persisted via the settings IPC.
import { Settings, Trash2 } from 'lucide';
import { icon } from './icons';
import { ipc } from '@platform/ipc-client';
import type { UserProfile } from '@shared/domain/profile';

export interface Sidebar {
  /** the sidebar column content; mount as the body grid's first child */
  panel: HTMLElement;
  toggle(): void;
  open(): void;
  close(): void;
  isOpen(): boolean;
}

const INPUT =
  'h-7 px-2 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-input)] text-[12px] ' +
  'text-[var(--text-primary)] placeholder:text-[var(--text-disabled)] outline-none focus:border-[var(--accent)]';

function textInput(placeholder: string): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'text';
  el.placeholder = placeholder;
  el.className = INPUT;
  return el;
}

/** `layout` is the body grid element; opening toggles `sidebar-open` on it to animate the columns. */
export function createSidebar(layout: HTMLElement): Sidebar {
  const panel = document.createElement('aside');
  panel.className = 'sidebar-panel';

  const inner = document.createElement('div');
  inner.className = 'sidebar-inner';

  const header = document.createElement('div');
  header.className =
    'h-9 flex items-center gap-2 px-3 shrink-0 border-b border-[var(--border)] ' +
    'text-[11px] font-semibold tracking-wide uppercase text-[var(--text-secondary)] select-none';
  header.append(icon(Settings, 15));
  const headerLabel = document.createElement('span');
  headerLabel.textContent = 'Settings';
  header.append(headerLabel);

  // ---- Profiles section ----
  const body = document.createElement('div');
  body.className = 'flex-1 overflow-y-auto p-3 flex flex-col gap-3';

  const sectionTitle = document.createElement('div');
  sectionTitle.className = 'text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]';
  sectionTitle.textContent = 'Profiles';

  const help = document.createElement('div');
  help.className = 'text-[11px] leading-snug text-[var(--text-disabled)]';
  help.textContent = 'Launchers for the new-terminal ▾ menu — a base shell plus an optional startup command.';

  const list = document.createElement('div');
  list.className = 'flex flex-col gap-1';

  const form = document.createElement('form');
  form.className = 'flex flex-col gap-2 pt-1';
  const nameInput = textInput('Name (e.g. Claude)');
  const shellSelect = document.createElement('select');
  shellSelect.className = INPUT;
  const cmdInput = textInput('Startup command (e.g. claude)');
  const addBtn = document.createElement('button');
  addBtn.type = 'submit';
  addBtn.className =
    'h-7 rounded-[var(--r-sm)] bg-[var(--accent)] text-[var(--accent-text)] text-[12px] font-medium ' +
    'cursor-pointer hover:bg-[var(--accent-hover)] transition-colors ease-[var(--ease-out)] duration-[var(--motion-fast)]';
  addBtn.textContent = 'Add profile';
  form.append(nameInput, shellSelect, cmdInput, addBtn);

  body.append(sectionTitle, help, list, form);
  inner.append(header, body);
  panel.append(inner);

  // ---- data ----
  function renderList(profiles: UserProfile[]): void {
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
    const row = document.createElement('div');
    row.className = 'group flex items-center gap-2 px-2 h-9 rounded-[var(--r-sm)] hover:bg-[var(--bg-hover)]';
    const text = document.createElement('div');
    text.className = 'flex-1 min-w-0';
    const name = document.createElement('div');
    name.className = 'text-[12px] text-[var(--text-primary)] truncate';
    name.textContent = p.name;
    const sub = document.createElement('div');
    sub.className = 'text-[10px] text-[var(--text-disabled)] truncate';
    sub.textContent = p.baseShellId + (p.startupCommand ? ` · ${p.startupCommand}` : '');
    text.append(name, sub);
    const del = document.createElement('button');
    del.type = 'button';
    del.title = 'Delete profile';
    del.className =
      'shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-[var(--r-sm)] cursor-pointer ' +
      'opacity-0 group-hover:opacity-100 text-[var(--text-secondary)] hover:bg-[var(--bg-active)] hover:text-[var(--danger)]';
    del.appendChild(icon(Trash2, 13));
    del.addEventListener('click', () => void removeProfile(p.id));
    row.append(text, del);
    return row;
  }

  async function refreshList(): Promise<void> {
    const settings = await ipc.settings.get().catch(() => null);
    renderList(settings?.profiles ?? []);
  }

  async function addProfile(): Promise<void> {
    const name = nameInput.value.trim();
    const baseShellId = shellSelect.value;
    if (!name || !baseShellId) return;
    const startupCommand = cmdInput.value.trim() || undefined;
    const settings = await ipc.settings.get();
    const profile: UserProfile = { id: crypto.randomUUID(), name, baseShellId, startupCommand };
    await ipc.settings.set({ profiles: [...settings.profiles, profile] });
    nameInput.value = '';
    cmdInput.value = '';
  }

  async function removeProfile(id: string): Promise<void> {
    const settings = await ipc.settings.get();
    await ipc.settings.set({ profiles: settings.profiles.filter((p) => p.id !== id) });
  }

  async function populateShells(): Promise<void> {
    const detected = await ipc.pty.profiles().catch(() => []);
    shellSelect.replaceChildren(
      ...detected.map((s) => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.label;
        return opt;
      }),
    );
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void addProfile();
  });
  ipc.settings.onChange((s) => renderList(s.profiles)); // stay in sync after add/remove
  void populateShells();
  void refreshList();

  // ---- open/close (push layout) ----
  let open = false;
  const apply = (): void => {
    layout.classList.toggle('sidebar-open', open);
  };
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        e.stopPropagation();
        open = false;
        apply();
      }
    },
    { capture: true },
  );

  // Refresh the shell picker whenever the panel is shown — detection may have completed (or a
  // shell appeared) since the last open, and the initial populate could have raced detection.
  const onOpen = (): void => {
    void populateShells();
    void refreshList();
  };

  return {
    panel,
    toggle() {
      open = !open;
      apply();
      if (open) onOpen();
    },
    open() {
      open = true;
      apply();
      onOpen();
    },
    close() {
      open = false;
      apply();
    },
    isOpen() {
      return open;
    },
  };
}
