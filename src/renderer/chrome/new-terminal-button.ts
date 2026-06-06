// "New terminal" split-button: [ + | ▾ ]. The plus opens a new terminal with the default shell;
// the chevron opens a dropdown of detected shell profiles. Lucide icons; pointer cursor.
import { Plus, ChevronDown, Minus } from 'lucide';
import { icon } from './icons';
import { ipc } from '@platform/ipc-client';

const BTN =
  'inline-flex items-center justify-center h-7 cursor-pointer text-[var(--text-secondary)] ' +
  'hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] ' +
  'transition-colors ease-[var(--ease-out)] duration-[var(--motion-fast)]';

export function createNewTerminalButton(opts: {
  onNew: () => void;
  onPick: (profileId: string) => void;
  onRemove: () => void;
}): HTMLElement {
  const group = document.createElement('div');
  group.className = 'app-no-drag flex items-center rounded-[var(--r-sm)] overflow-hidden';

  const plus = document.createElement('button');
  plus.type = 'button';
  plus.title = 'New terminal';
  plus.setAttribute('aria-label', 'New terminal');
  plus.className = `${BTN} w-7`;
  plus.appendChild(icon(Plus, 16));
  plus.addEventListener('click', () => opts.onNew());

  const chevron = document.createElement('button');
  chevron.type = 'button';
  chevron.title = 'Choose terminal profile';
  chevron.setAttribute('aria-label', 'Choose terminal profile');
  chevron.className = `${BTN} w-5`;
  chevron.appendChild(icon(ChevronDown, 14));

  let menu: HTMLElement | null = null;
  let opening = false;

  const closeMenu = (): void => {
    menu?.remove();
    menu = null;
    document.removeEventListener('mousedown', onDocDown, true);
    window.removeEventListener('keydown', onMenuKey, true);
  };
  const onDocDown = (e: MouseEvent): void => {
    const t = e.target as Node;
    if (menu && !menu.contains(t) && !group.contains(t)) closeMenu();
  };
  const onMenuKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && menu) {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    }
  };

  async function openMenu(): Promise<void> {
    if (menu) {
      closeMenu();
      return;
    }
    if (opening) return; // a fetch is already in flight — avoid building two menus
    opening = true;
    const profiles = await ipc.pty.profiles().catch(() => []);
    opening = false;
    if (menu) return; // closed/reopened while fetching
    menu = document.createElement('div');
    menu.className =
      'app-no-drag fixed z-50 min-w-[180px] py-1 rounded-[var(--r-md)] border border-[var(--border)] ' +
      'bg-[var(--bg-elevated)] shadow-[0_8px_24px_rgba(0,0,0,0.36)]';
    const rect = group.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;

    if (profiles.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'px-3 py-1.5 text-[11px] text-[var(--text-disabled)]';
      empty.textContent = 'No profiles found';
      menu.appendChild(empty);
    } else {
      for (const p of profiles) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className =
          'flex w-full items-center px-3 py-1.5 text-left text-[12px] cursor-pointer ' +
          'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]';
        item.textContent = p.label;
        item.addEventListener('click', () => {
          closeMenu();
          opts.onPick(p.id);
        });
        menu.appendChild(item);
      }
    }

    document.body.appendChild(menu);
    document.addEventListener('mousedown', onDocDown, true);
    window.addEventListener('keydown', onMenuKey, true);
  }

  chevron.addEventListener('click', () => void openMenu());

  const minus = document.createElement('button');
  minus.type = 'button';
  minus.title = 'Close last terminal';
  minus.setAttribute('aria-label', 'Close last terminal');
  minus.className = `${BTN} w-7`;
  minus.appendChild(icon(Minus, 16));
  minus.addEventListener('click', () => opts.onRemove());

  group.append(plus, chevron, minus);
  return group;
}
