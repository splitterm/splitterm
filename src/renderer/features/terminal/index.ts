import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TermId } from '@shared/ids';
import { ipc } from '@platform/ipc-client';
import { registerTerminal, unregisterTerminal, writeToPty, resizePty, ackPty } from '@platform/pty-port';
import { registerPane, deletePane } from '@platform/pane-registry';
import { getSettings } from '@platform/settings-controller';
import { readTerminalTheme } from './theme';
import { createTerminalSearch } from './search';

export interface TerminalInstance {
  termId: TermId;
  /** stable element to mount into a tile cell (re-parented by the tiling engine) */
  el: HTMLElement;
}

/**
 * Create an xterm terminal in its own stable element, spawn a shell, and register a pane handle.
 * The element starts detached; the tiling engine appends it to a cell, at which point the
 * ResizeObserver fits it to the real size. M2 uses the DOM renderer; WebGL pooling lands in M2b.
 */
export async function createTerminal(profileId?: string, title = ''): Promise<TerminalInstance> {
  const el = document.createElement('div');
  el.className = 'term-pane';

  const s = getSettings();
  const term = new Terminal({
    allowProposedApi: true,
    scrollback: s.terminal.scrollback,
    cursorBlink: s.terminal.cursorBlink,
    cursorStyle: s.terminal.cursorStyle,
    fontFamily: s.font.family,
    fontSize: s.font.size,
    theme: readTerminalTheme(),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(el);

  // Scrollback search, owned by this pane. Ctrl+F (or Ctrl+Shift+F / Cmd+F) opens it; intercepted at
  // the xterm level so it never reaches the shell, and so it always targets the focused pane.
  const search = createTerminalSearch(term);
  el.appendChild(search.el);
  term.attachCustomKeyEventHandler((e) => {
    if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      search.open();
      return false;
    }
    return true;
  });

  const { id } = await ipc.pty.spawn({ cols: term.cols || 80, rows: term.rows || 24, profileId });

  registerTerminal(
    id,
    (data) => term.write(data, () => ackPty(id, data.length)),
    // Local exit banner — the host session is already gone, so it isn't flow-controlled.
    (code) => term.write(`\r\n\x1b[90m[process exited: ${code}]\x1b[0m\r\n`),
  );
  term.onData((d) => writeToPty(id, d));

  // rAF-coalesce fits so a gutter drag (many size observations/sec) refits at most once per frame
  // instead of thrashing the expensive FitAddon.fit() + a PTY resize on every observation.
  let fitScheduled = false;
  const refit = (): void => {
    if (fitScheduled) return;
    fitScheduled = true;
    requestAnimationFrame(() => {
      fitScheduled = false;
      if (el.isConnected && el.clientWidth > 0 && el.clientHeight > 0) {
        fit.fit();
        resizePty(id, term.cols, term.rows);
      }
    });
  };
  const observer = new ResizeObserver(refit);
  observer.observe(el);

  registerPane(id, {
    el,
    title,
    focus: () => term.focus(),
    fit: refit,
    applySettings: (next) => {
      term.options.fontFamily = next.font.family;
      term.options.fontSize = next.font.size;
      term.options.scrollback = next.terminal.scrollback;
      term.options.cursorStyle = next.terminal.cursorStyle;
      term.options.cursorBlink = next.terminal.cursorBlink;
      term.options.theme = readTerminalTheme(); // re-read CSS vars (theme may have changed)
      refit();
    },
    dispose: () => {
      observer.disconnect();
      search.dispose();
      unregisterTerminal(id);
      ipc.pty.kill({ id });
      term.dispose();
      deletePane(id);
    },
  });

  return { termId: id, el };
}
