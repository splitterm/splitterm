import { PanelLeft } from 'lucide';
import { icon } from './icons';
import { createNewTerminalButton } from './new-terminal-button';

// The top bar: a draggable window region with the sidebar toggle + brand + new-terminal button.
// Native window controls (min/max/close) are painted by the OS on the right via titleBarOverlay.
export function createTopbar(opts: {
  onToggleSidebar: () => void;
  onNewTerminal: () => void;
  onPickProfile: (profileId: string) => void;
  onRemoveTerminal: () => void;
}): HTMLElement {
  const bar = document.createElement('header');
  bar.className =
    'app-drag flex items-center gap-2 h-full px-2 bg-[var(--bg-app)] border-b border-[var(--border)]';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.setAttribute('aria-label', 'Toggle sidebar');
  toggle.className =
    'app-no-drag inline-flex items-center justify-center w-7 h-7 rounded-[var(--r-sm)] cursor-pointer ' +
    'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] ' +
    'transition-colors ease-[var(--ease-out)] duration-[var(--motion-fast)] motion-reduce:transition-none';
  toggle.appendChild(icon(PanelLeft, 18));
  toggle.addEventListener('click', opts.onToggleSidebar);

  const brand = document.createElement('span');
  brand.className = 'text-[12px] font-semibold tracking-wide text-[var(--text-secondary)] select-none';
  brand.textContent = 'splitterm';

  const newTerminal = createNewTerminalButton({
    onNew: opts.onNewTerminal,
    onPick: opts.onPickProfile,
    onRemove: opts.onRemoveTerminal,
  });

  bar.append(toggle, brand, newTerminal);
  return bar;
}
