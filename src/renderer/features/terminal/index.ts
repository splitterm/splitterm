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
import { createTerminalClipboard } from './clipboard';
import { parseOsc7 } from './osc7';

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
export async function createTerminal(profileId?: string, title = '', initialCwd?: string): Promise<TerminalInstance> {
  const el = document.createElement('div');
  el.className = 'term-pane';

  // Working directory: the spawn cwd, then kept current from the shell's OSC 7 reports. A split reads
  // this (PaneHandle.cwd) so the new pane opens where the focused pane is.
  let cwd = initialCwd;

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

  // Track the cwd the shell reports via OSC 7 (`ESC ]7;file://host/path BEL`).
  const osc7 = term.parser.registerOscHandler(7, (data) => {
    const dir = parseOsc7(data);
    if (dir) cwd = dir;
    return true;
  });

  // Search + copy/paste, owned by this pane. Both are intercepted at the xterm level so they never
  // reach the shell and always target the focused pane. One custom handler routes the keys.
  const search = createTerminalSearch(term);
  el.appendChild(search.el);
  const clip = createTerminalClipboard(term, el);
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
    if (mod && e.code === 'KeyF') {
      e.preventDefault();
      search.open(); // Ctrl+F / Ctrl+Shift+F / Cmd+F
      return false;
    }
    if (clip.handleKey(e)) {
      e.preventDefault();
      return false;
    }
    return true;
  });

  const { id } = await ipc.pty.spawn({ cols: term.cols || 80, rows: term.rows || 24, profileId, cwd });

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
    profileId,
    focus: () => term.focus(),
    fit: refit,
    cwd: () => cwd,
    applySettings: (next) => {
      term.options.fontFamily = next.font.family;
      term.options.fontSize = next.font.size;
      term.options.scrollback = next.terminal.scrollback;
      term.options.cursorStyle = next.terminal.cursorStyle;
      term.options.cursorBlink = next.terminal.cursorBlink;
      term.options.theme = readTerminalTheme(); // re-read CSS vars (theme may have changed)
      search.reapply(); // recolor live search highlights if the bar is open
      refit();
    },
    dispose: () => {
      observer.disconnect();
      osc7.dispose();
      search.dispose();
      clip.dispose();
      unregisterTerminal(id);
      ipc.pty.kill({ id });
      term.dispose();
      deletePane(id);
    },
  });

  return { termId: id, el };
}
