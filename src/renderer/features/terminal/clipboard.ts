// Per-pane copy/paste + a right-click context menu, owned by the terminal feature. Clipboard access
// goes through the typed IPC bridge (ipc.clipboard) — preload → main's Electron clipboard module —
// so the sandboxed renderer never touches the OS directly. Paste uses term.paste() so bracketed-
// paste mode is honored (a multi-line paste can't auto-run as commands when the shell enables it).
//
// Keybindings (chosen not to clash with the shell): Copy = Ctrl/Cmd+Shift+C, or Ctrl/Cmd+C WHEN
// there is a selection (otherwise Ctrl+C falls through as SIGINT), or Ctrl+Insert. Paste = Ctrl/Cmd+
// Shift+V or Shift+Insert. Plain Ctrl+C / Ctrl+V stay with the shell (SIGINT / readline verbatim).
import type { Terminal } from '@xterm/xterm';
import { Copy, ClipboardPaste, TextSelect, type IconNode } from 'lucide';
import { ipc } from '@platform/ipc-client';
import { allPanes } from '@platform/pane-registry';
import { isBroadcasting } from '@platform/broadcast';
import { icon } from './icon';

export interface TerminalClipboard {
  /** handle a keydown for copy/paste; returns true if it consumed the event */
  handleKey(e: KeyboardEvent): boolean;
  dispose(): void;
}

export function createTerminalClipboard(term: Terminal, el: HTMLElement): TerminalClipboard {
  async function copy(): Promise<void> {
    if (term.hasSelection()) await ipc.clipboard.writeText(term.getSelection()).catch(() => {});
  }
  async function paste(): Promise<void> {
    const text = await ipc.clipboard.readText().catch(() => '');
    if (!text) return;
    // Broadcast: paste into every pane via its OWN term.paste, so each applies its own bracketed-paste
    // mode (rather than re-sending the focused pane's already-wrapped bytes). Includes this pane.
    if (isBroadcasting()) for (const p of allPanes()) p.paste(text);
    else term.paste(text); // honors bracketed-paste mode
  }

  // ---- right-click context menu ----
  let menu: HTMLElement | null = null;
  const closeMenu = (): void => {
    menu?.remove();
    menu = null;
    document.removeEventListener('mousedown', onDocDown, true);
    window.removeEventListener('keydown', onMenuKey, true);
  };
  const onDocDown = (e: MouseEvent): void => {
    if (menu && !menu.contains(e.target as Node)) closeMenu();
  };
  const onMenuKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && menu) {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    }
  };

  function openMenu(x: number, y: number): void {
    closeMenu();
    const hasSelection = term.hasSelection();
    menu = document.createElement('div');
    menu.className =
      'term-context-menu app-no-drag fixed z-50 min-w-[160px] py-1 rounded-[var(--r-md)] border ' +
      'border-[var(--border)] bg-[var(--bg-elevated)] shadow-[0_8px_24px_rgba(0,0,0,0.36)]';

    const item = (glyph: IconNode, label: string, enabled: boolean, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.disabled = !enabled;
      b.className =
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] cursor-pointer ' +
        'text-[var(--text-primary)] hover:bg-[var(--bg-hover)] ' +
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent';
      b.append(icon(glyph, 14));
      const span = document.createElement('span');
      span.textContent = label;
      b.append(span);
      b.addEventListener('mousedown', (e) => e.preventDefault()); // don't blur the terminal
      b.addEventListener('click', () => {
        closeMenu();
        onClick();
        term.focus(); // keep keyboard focus on the terminal after the action
      });
      return b;
    };

    menu.append(
      item(Copy, 'Copy', hasSelection, () => void copy()),
      item(ClipboardPaste, 'Paste', true, () => void paste()),
      item(TextSelect, 'Select all', true, () => term.selectAll()),
    );

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);
    // Clamp into the viewport so a click near the edge doesn't push the menu off-screen.
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;

    document.addEventListener('mousedown', onDocDown, true);
    window.addEventListener('keydown', onMenuKey, true);
  }

  const onContextMenu = (e: MouseEvent): void => {
    // Don't hijack right-click inside the search overlay — let its input keep its native menu.
    if ((e.target as HTMLElement | null)?.closest('.term-search')) return;
    e.preventDefault();
    openMenu(e.clientX, e.clientY);
  };
  el.addEventListener('contextmenu', onContextMenu);

  // ---- keyboard ----
  function handleKey(e: KeyboardEvent): boolean {
    if (e.type !== 'keydown' || e.altKey) return false;
    const mod = e.ctrlKey || e.metaKey;
    // Copy
    if (mod && e.shiftKey && e.code === 'KeyC') {
      void copy();
      return true;
    }
    if (mod && !e.shiftKey && e.code === 'KeyC' && term.hasSelection()) {
      void copy();
      term.clearSelection(); // so a following Ctrl+C is a normal SIGINT
      return true;
    }
    if (e.ctrlKey && !e.shiftKey && e.code === 'Insert' && term.hasSelection()) {
      void copy();
      return true;
    }
    // Paste
    if (mod && e.shiftKey && e.code === 'KeyV') {
      void paste();
      return true;
    }
    // Plain Cmd+V on macOS (where Cmd isn't a control char, so the readline-conflict rationale for
    // leaving plain Ctrl+V to the shell doesn't apply). Gated on metaKey, so Windows Ctrl+V is untouched.
    if (e.metaKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyV') {
      void paste();
      return true;
    }
    if (e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'Insert') {
      void paste();
      return true;
    }
    return false;
  }

  return {
    handleKey,
    dispose: () => {
      closeMenu();
      el.removeEventListener('contextmenu', onContextMenu);
    },
  };
}
