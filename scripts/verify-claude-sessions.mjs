// Runtime verification of the AUTHORITATIVE Claude status path: the pty-host watches
// ~/.claude/sessions/<pid>.json, correlates each session's PID to a pane via the process tree, and
// drives the sidebar dot (busy→claudeWorking, waiting→attention, idle/gone→idle). We point the watcher
// at a temp dir (SPLITTERM_CLAUDE_SESSIONS_DIR) and write a session file whose pid is the pane's own
// shell PID — a depth-0 self-correlation — so the test needs no real `claude` process, just the pipeline.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-claude-sessions');
const sessionsDir = path.join(os.tmpdir(), 'splitterm-e2e-claude-sessions-dir');
rmSync(userDataDir, { recursive: true, force: true });
rmSync(sessionsDir, { recursive: true, force: true });
mkdirSync(sessionsDir, { recursive: true }); // must exist before the host arms its fs.watch

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = await electron.launch({
  executablePath: electronPath,
  args: [mainJs, `--user-data-dir=${userDataDir}`],
  env: { ...process.env, SPLITTERM_CLAUDE_SESSIONS_DIR: sessionsDir },
});

const result = {};
let win = null;
let sessionFile = null;

async function finish(code) {
  console.log('RESULT ' + JSON.stringify(result, null, 2));
  await app.close().catch(() => {});
  rmSync(userDataDir, { recursive: true, force: true });
  rmSync(sessionsDir, { recursive: true, force: true });
  process.exit(code);
}
const statusOf = () => win.evaluate(() => document.querySelector('.pane-status-dot')?.getAttribute('data-status') ?? '');
const waitStatus = async (want, tries = 35) => {
  for (let i = 0; i < tries; i++) {
    if ((await statusOf()) === want) return true;
    await sleep(200);
  }
  return false;
};
const writeStatus = (pid, status) => writeFileSync(sessionFile, JSON.stringify({ pid, sessionId: 'e2e', cwd: 'C:/x', status }));

try {
  for (let i = 0; i < 30 && !win; i++) {
    for (const w of app.windows()) if (await w.locator('#app').count().catch(() => 0)) { win = w; break; }
    if (!win) await sleep(300);
  }
  if (!win) { result.error = 'no window'; await finish(1); }

  await win.getByRole('button', { name: 'Toggle sidebar' }).click();
  await sleep(300);
  await win.getByRole('button', { name: 'New terminal' }).click();
  await sleep(2400);
  result.statusInitial = await statusOf();

  // Discover the pane's pty shell PID ($PID in PowerShell == the spawned shell). The OUTPUT line carries
  // the number; the command echo carries the literal "$PID", so /SPLPID=(\d+)/ only matches the result.
  await win.locator('.xterm-screen').first().click();
  await sleep(150);
  await win.keyboard.type('Write-Host "SPLPID=$PID"');
  await win.keyboard.press('Enter');
  let shellPid = 0;
  for (let i = 0; i < 25 && !shellPid; i++) {
    const rows = await win.locator('.xterm-rows').first().innerText().catch(() => '');
    const m = rows.match(/SPLPID=(\d+)/);
    if (m) shellPid = Number(m[1]);
    if (!shellPid) await sleep(200);
  }
  result.shellPid = shellPid;
  if (!shellPid) { result.error = 'could not read shell PID'; await finish(1); }
  sessionFile = path.join(sessionsDir, `${shellPid}.json`);

  // busy → claudeWorking
  writeStatus(shellPid, 'busy');
  result.busyLit = await waitStatus('claudeWorking');

  // waiting (e.g. permission prompt) → attention
  writeStatus(shellPid, 'waiting');
  result.waitingLit = await waitStatus('attention');

  // Needs-input is authoritative: clicking into / typing in the pane must NOT clear it (only the
  // watcher does, once Claude moves on). Click + type a char and confirm it's still 'attention'.
  await win.locator('.xterm-screen').first().click();
  await win.keyboard.type('y');
  await sleep(700);
  result.attentionSurvivesInput = (await statusOf()) === 'attention';

  // idle (between turns) → idle
  writeStatus(shellPid, 'idle');
  result.idleCleared = await waitStatus('idle');

  // busy again → re-lights (proves it's live, not a one-shot)
  writeStatus(shellPid, 'busy');
  result.reLit = await waitStatus('claudeWorking');

  // session file gone (claude exited) → reverts to idle
  rmSync(sessionFile, { force: true });
  result.goneReverted = await waitStatus('idle');

  const ok =
    result.statusInitial !== 'claudeWorking' &&
    result.busyLit &&
    result.waitingLit &&
    result.attentionSurvivesInput &&
    result.idleCleared &&
    result.reLit &&
    result.goneReverted;
  result.ok = ok;
  await finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  if (win) await win.screenshot({ path: path.resolve('scripts/verify-claude-sessions-fail.png') }).catch(() => {});
  await finish(1);
}
