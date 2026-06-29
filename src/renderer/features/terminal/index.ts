import { Terminal, type FontWeight } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import '@xterm/xterm/css/xterm.css';
import type { TermId } from '@shared/ids';
import { ipc } from '@platform/ipc-client';
import { registerTerminal, unregisterTerminal, writeToPty, resizePty, ackPty, whenPortReady } from '@platform/pty-port';
import { registerPane, deletePane, allPanes, notifyPaneTitleChange, notifyPaneStatusChange, type PaneStatus } from '@platform/pane-registry';
import { isBroadcasting } from '@platform/broadcast';
import { getSettings } from '@platform/settings-controller';
import { readTerminalTheme } from './theme';
import { createTerminalSearch } from './search';
import { createTerminalClipboard } from './clipboard';
import { parseOsc7 } from './osc7';
import { tryAttachWebgl } from './webgl';
import { MAX_SCROLLBACK_CHARS } from '@shared/domain/layout-tree';

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
// How many scrollback rows to capture per pane for session-restore history — bounds session.json
// (the trust boundary also caps the stored string).
const SERIALIZE_SCROLLBACK = 1000;

// How long a pane's output must be quiet before it drops from 'working' to 'idle' (or 'attention').
const ACTIVE_IDLE_MS = 1200;

// Claude-Code working detection (see the status block below).
const FOOTER_SCAN_ROWS = 12; // bottom rows of the viewport that hold Claude's footer + (tall) input box
const CONFIRM_SCANS = 10; // scans (~2s) to wait for the affordance to animate before settling a static one
const ECHO_WINDOW_MS = 250; // output within this of a keystroke is treated as echo, not 'working'
const GRACE_MS = 800; // affordance must be gone this long before leaving 'claudeWorking' (debounce a half-frame)
const STALE_MS = 8000; // an affordance that animated then froze this long is stale (hung / finished Claude)
// Claude renders an "esc to interrupt" affordance while processing; punctuation varies by version, so
// match the bare, whitespace-tolerant phrase (anchored to the footer region + line liveness, not punctuation).
const CLAUDE_WORKING_RE = /esc\s+to\s+interrupt/i;

export async function createTerminal(
  profileId?: string,
  title = '',
  initialCwd?: string,
  restore = false,
  replay?: string,
  noCommands = false,
): Promise<TerminalInstance> {
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
    cursorInactiveStyle: s.terminal.cursorInactiveStyle,
    lineHeight: s.terminal.lineHeight,
    letterSpacing: s.terminal.letterSpacing,
    fontWeight: s.terminal.fontWeight as FontWeight,
    fontFamily: s.font.family,
    fontSize: s.font.size,
    theme: readTerminalTheme(),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const serializeAddon = new SerializeAddon();
  term.loadAddon(serializeAddon);

  // Replay saved scrollback (session restore) as read-only history. Written BEFORE open() per the
  // addon-serialize guidance (avoids rendering incomplete frames). `term.write` parses ASYNCHRONOUSLY,
  // so we can't rely on registration order to keep replayed escape sequences from reaching app
  // handlers — instead `replaying` gates the OSC 7 handler below until the write callback fires (after
  // the replay is fully parsed). No separator is written: it would be re-captured on the next save and
  // stack across restarts; the bounded history simply flows into the fresh shell (tmux-style).
  let replaying = !!replay;
  if (replay) {
    term.write(replay, () => {
      replaying = false;
    });
  }
  term.open(el);

  // GPU renderer (opt-in). Must load AFTER open() — it needs the live canvas. Returns null and stays
  // on the DOM renderer when WebGL is off, unavailable, or the context budget is full; on a runtime
  // context loss it self-disposes (after xterm's ~3s GPU-restore wait) and the pane reverts to DOM.
  // Tracked so the pane releases its context on close.
  const webgl = s.terminal.webgl ? tryAttachWebgl(term) : null;

  // Track the cwd the shell reports via OSC 7 (`ESC ]7;file://host/path BEL`). Ignore any OSC 7 that
  // arrives while the saved scrollback is still being parsed — replayed (untrusted) content must not
  // drive app logic; only the live shell's reports should move the cwd.
  const osc7 = term.parser.registerOscHandler(7, (data) => {
    if (replaying) return true; // swallow replayed OSC 7 (do nothing) until the replay is consumed
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

  // Wait for the firehose port before spawning, so a spawn during the reload gap can't race the
  // host's orphan-kill (the new session would be created against a stale port and killed).
  await whenPortReady();
  const { id, hostDown } = await ipc.pty.spawn({
    cols: term.cols || 80,
    rows: term.rows || 24,
    profileId,
    cwd,
    shellIntegration: s.terminal.shellIntegration,
    restore,
    noCommands,
  });
  // The pty-host crash-looped and gave up: there's no live shell, so banner the pane (it stays
  // closeable) instead of leaving it blank and frozen.
  if (hostDown) {
    term.write('\r\n\x1b[1;31m[pty-host unavailable — restart splitterm to use terminals again.]\x1b[0m\r\n');
  }

  // Live activity status (shown in the Sessions sidebar). Mostly firehose-derived: streaming output ⇒
  // 'working'; quiet ⇒ 'idle' (or 'attention' if the shell rang the bell); exit ⇒ 'exited'. ON TOP we
  // surface Claude Code: while it processes a turn it draws an animated "esc to interrupt" affordance on
  // its bottom status line, so the pane reads 'claudeWorking' (Claude's colour). Typing never shows
  // progress: generic 'working' is echo-gated, and 'claudeWorking' needs a GENUINELY ANIMATING footer
  // (the affordance LINE keeps changing), so a static "esc to interrupt" (a cat'd file, a hung/exited
  // Claude, or your own composing) never lights it.
  let status: PaneStatus = 'idle';
  let belled = false;
  let claudeWorking = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  let lastInputAt = 0; // performance.now() of the last genuine keystroke — used to ignore typing echo
  let affLineSig = ''; // text of the matched affordance line + when it last changed (its own liveness signal)
  let affLineAt = 0;
  let lastAffordanceAt = 0; // last time the affordance was present — debounces a turn-end half-frame
  let affordancePresent = false; // was the affordance present on the previous scan
  let affordanceAnimated = false; // has the affordance line changed since it appeared (i.e. it's really working)
  let presentScans = 0; // scans since the affordance appeared — bounds the confirm poll for a static line
  // Count of term.write() calls still being parsed. xterm fires onData both for genuine user input AND
  // for its automatic replies to host queries (cursor-position/device-attributes/colour) — generated
  // WHILE PARSING program output (an in-flight write). So onData with parsingOutput > 0 is a synthetic
  // reply, not a keystroke; the broadcast fan-out + the echo gate both rely on this.
  let parsingOutput = 0;

  const setStatus = (next: PaneStatus): void => {
    if (next === status) return;
    status = next;
    notifyPaneStatusChange(id);
  };
  const armIdle = (): void => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => setStatus(belled ? 'attention' : 'idle'), ACTIVE_IDLE_MS);
  };
  const enterClaudeWorking = (): void => {
    claudeWorking = true;
    setStatus('claudeWorking');
    clearTimeout(idleTimer); // no idle timeout while Claude is working
  };
  const exitClaudeWorking = (): void => {
    if (!claudeWorking) return;
    claudeWorking = false;
    setStatus(belled ? 'attention' : 'idle');
  };
  const markOutput = (): void => {
    if (status === 'exited') return; // 'exited' is terminal — no later data resurrects a dead pane
    if (status !== 'working' && status !== 'claudeWorking') belled = false; // fresh burst → drop a stale bell
    scheduleScan(); // re-check the Claude affordance
    if (claudeWorking) {
      setStatus('claudeWorking');
      clearTimeout(idleTimer);
      return;
    }
    if (performance.now() - lastInputAt < ECHO_WINDOW_MS) return; // this output is echo of the user's own typing
    setStatus('working');
    armIdle();
  };

  // The logical lines of the bottom FOOTER_SCAN_ROWS rows of the LIVE viewport — anchored to baseY + rows,
  // NOT the cursor (Claude draws its footer at the screen bottom while the cursor sits in the input box).
  // Wrapped continuation rows are joined onto their logical line so a wrapped footer matches as one line.
  const footerLines = (): string[] => {
    const buf = term.buffer.active;
    const bottom = Math.min(buf.baseY + term.rows - 1, buf.length - 1);
    const top = Math.max(0, bottom - FOOTER_SCAN_ROWS + 1);
    const lines: string[] = [];
    for (let y = top; y <= bottom; y++) {
      const line = buf.getLine(y);
      if (!line) continue;
      const sLine = line.translateToString(true);
      if (line.isWrapped && lines.length) lines[lines.length - 1] += sLine;
      else lines.push(sLine);
    }
    return lines;
  };
  // Drive claudeWorking from the live affordance, constrained by REGION (footer rows) + LIVENESS keyed on
  // the AFFORDANCE LINE: a genuinely working Claude animates that line (spinner / elapsed seconds), so it
  // keeps changing; a static "esc to interrupt" (a cat'd file, a hung Claude) never animates and is
  // ignored — and typing below it doesn't count (only the matched line's own changes do).
  const scanClaude = (): void => {
    if (status === 'exited') return;
    const now = performance.now();
    const affLine = footerLines().find((l) => CLAUDE_WORKING_RE.test(l)) ?? '';
    const present = affLine !== '';
    const changed = affLine !== affLineSig;
    if (changed) {
      affLineSig = affLine;
      affLineAt = now;
    }
    if (present) {
      lastAffordanceAt = now;
      if (!affordancePresent) {
        affordancePresent = true; // the affordance just appeared — don't count the appearance as animation
        affordanceAnimated = false;
        presentScans = 0;
      } else {
        presentScans++;
        if (changed) affordanceAnimated = true; // the affordance line itself changed → Claude is animating
      }
      if (affordanceAnimated && now - affLineAt < STALE_MS) enterClaudeWorking();
      else if (affordanceAnimated) exitClaudeWorking(); // it animated, then froze for STALE_MS → hung / done
    } else {
      affordancePresent = false;
      affordanceAnimated = false;
      presentScans = 0;
      if (claudeWorking && now - lastAffordanceAt >= GRACE_MS) exitClaudeWorking(); // debounce a half-drawn frame
    }
    // Keep sampling without new output while working, OR while still confirming a freshly-seen affordance.
    // Bounded by CONFIRM_SCANS so a STATIC affordance settles and stops polling (output re-arms via markOutput).
    if (claudeWorking || (affordancePresent && presentScans < CONFIRM_SCANS)) scheduleScan();
  };
  const scheduleScan = (): void => {
    if (scanTimer) return; // throttle: at most one scan per window, so a busy footer still gets sampled
    scanTimer = setTimeout(() => {
      scanTimer = undefined;
      scanClaude();
    }, 200);
  };
  const bellEvt = term.onBell(() => {
    belled = true; // a tool finished / wants attention; resolves to 'attention' once output goes quiet
    if (status === 'idle') setStatus('attention'); // ...or right away if the pane was already quiet
  });

  registerTerminal(
    id,
    (data) => {
      markOutput();
      parsingOutput++;
      term.write(data, () => {
        parsingOutput--;
        ackPty(id, data.length);
      });
    },
    // Local exit banner — the host session is already gone, so it isn't flow-controlled.
    (code) => {
      clearTimeout(idleTimer);
      clearTimeout(scanTimer); // stop the Claude-working self-heal poll
      claudeWorking = false;
      setStatus('exited');
      term.write(`\r\n\x1b[90m[process exited: ${code}]\x1b[0m\r\n`);
    },
  );
  term.onData((d) => {
    // The user is engaging — clear any pending bell (even during the post-bell 'working' window, so a
    // stale bell can't surface as a spurious 'attention' later) and drop an active 'attention'.
    belled = false;
    if (status === 'attention') setStatus('idle');
    if (parsingOutput === 0) lastInputAt = performance.now(); // genuine keystroke (not a synthetic query reply)
    // Broadcast input: mirror genuine keystrokes to every pane's PTY. Excludes synthetic query replies
    // (which fire while parsing output, parsingOutput > 0) and, since those are a background pane's only
    // onData source, never originates a broadcast from a non-focused pane. The fan-out includes this
    // pane, so it still gets its own keystroke. (Paste is fanned out separately, in the clipboard.)
    if (isBroadcasting() && parsingOutput === 0) for (const p of allPanes()) p.write(d);
    else writeToPty(id, d);
  });

  // Live pane title: track what the shell reports via OSC 0/2 (the running program, cwd, etc.). The
  // display title is this when set, else the profile name; notify the tiling so the chip + sidebar
  // refresh. Bounded so a hostile/huge title can't bloat the chip.
  let oscTitle = '';
  const titleEvt = term.onTitleChange((t) => {
    const next = t.trim().slice(0, 256);
    if (next === oscTitle) return;
    oscTitle = next;
    // A named pane shows its profile title regardless of the OSC title, so changing oscTitle can't
    // change what's displayed — don't notify (avoids re-render churn from a title-spamming shell).
    if (!title) notifyPaneTitleChange(id);
  });

  // rAF-coalesce fits so a gutter drag (many size observations/sec) refits at most once per frame
  // instead of thrashing the expensive FitAddon.fit() + a PTY resize on every observation.
  let fitScheduled = false;
  let lastCols = 0;
  let lastRows = 0;
  const refit = (): void => {
    if (fitScheduled) return;
    fitScheduled = true;
    requestAnimationFrame(() => {
      fitScheduled = false;
      if (el.isConnected && el.clientWidth > 0 && el.clientHeight > 0) {
        fit.fit();
        // Only resize the PTY when the grid actually changed. fit() already no-ops on unchanged dims,
        // but refitAll() fans this over every pane on each layout op and a gutter drag fires the
        // observer ~60×/s — without this guard each would post a redundant cross-process resize +
        // ConPTY ResizePseudoConsole syscall (and a spurious SIGWINCH that makes TUIs repaint).
        if (term.cols !== lastCols || term.rows !== lastRows) {
          lastCols = term.cols;
          lastRows = term.rows;
          resizePty(id, term.cols, term.rows);
        }
      }
    });
  };
  const observer = new ResizeObserver(refit);
  observer.observe(el);

  registerPane(id, {
    el,
    title, // persistent profile title (for restore)
    // An explicit profile name wins (the user chose it); the shell's live OSC title fills in for an
    // UNNAMED ("+") pane — so a default terminal shows what's running / its cwd.
    displayTitle: () => title || oscTitle,
    profileId,
    focus: () => term.focus(),
    fit: refit,
    write: (data) => writeToPty(id, data),
    paste: (data) => term.paste(data), // applies THIS pane's bracketed-paste mode
    cwd: () => cwd,
    applySettings: (next) => {
      term.options.fontFamily = next.font.family;
      term.options.fontSize = next.font.size;
      term.options.scrollback = next.terminal.scrollback;
      term.options.cursorStyle = next.terminal.cursorStyle;
      term.options.cursorInactiveStyle = next.terminal.cursorInactiveStyle;
      term.options.cursorBlink = next.terminal.cursorBlink;
      term.options.lineHeight = next.terminal.lineHeight;
      term.options.letterSpacing = next.terminal.letterSpacing;
      term.options.fontWeight = next.terminal.fontWeight as FontWeight;
      term.options.theme = readTerminalTheme(); // re-read CSS vars (theme may have changed)
      search.reapply(); // recolor live search highlights if the bar is open
      refit();
    },
    status: () => status,
    // Capture the buffer for session-restore history. Total — never throws into the caller.
    // `excludeAltBuffer` keeps a full-screen TUI (vim/htop) open at save time from capturing its dead
    // alt-screen (which would leave the restored pane stuck there) — we want the real scrollback.
    // `excludeModes` keeps live terminal modes (mouse tracking, app cursor keys) out of the replay so
    // they can't corrupt input to the fresh shell. Shrink to fit the storage cap so a self-produced
    // capture is never silently dropped on read (rather than persisting a blob that gets rejected).
    serialize: () => {
      try {
        let lines = SERIALIZE_SCROLLBACK;
        let out = serializeAddon.serialize({ scrollback: lines, excludeAltBuffer: true, excludeModes: true });
        while (out.length > MAX_SCROLLBACK_CHARS && lines > 0) {
          lines = Math.floor(lines / 2);
          out = serializeAddon.serialize({ scrollback: lines, excludeAltBuffer: true, excludeModes: true });
        }
        return out.length <= MAX_SCROLLBACK_CHARS ? out : '';
      } catch {
        return '';
      }
    },
    dispose: () => {
      observer.disconnect();
      clearTimeout(idleTimer);
      clearTimeout(scanTimer);
      osc7.dispose();
      titleEvt.dispose();
      bellEvt.dispose();
      search.dispose();
      clip.dispose();
      webgl?.dispose(); // free the GPU context before the terminal so it returns to the budget
      unregisterTerminal(id);
      ipc.pty.kill({ id });
      term.dispose();
      deletePane(id);
    },
  });

  return { termId: id, el };
}
