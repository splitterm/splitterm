// Runtime verification of "Restore working directory only" (restorePathOnly). Pre-seeds an "Echo"
// profile (the default the "+" opens) with startup `echo STARTUP_MARK_77` and restore `echo
// RESTORE_MARK_77`, plus restorePathOnly:true. Launch 1: open the default → STARTUP runs (a fresh
// spawn ignores the setting). Launch 2 (same dir): the pane is RESTORED, but with restorePathOnly on,
// NEITHER the startup NOR the restore command runs — the shell is alive (a typed LIVE marker appears)
// yet no STARTUP/RESTORE marker does. Proves the shell + cwd are restored without re-running commands.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-restore-path-only');
rmSync(userDataDir, { recursive: true, force: true });
mkdirSync(userDataDir, { recursive: true });

writeFileSync(
  path.join(userDataDir, 'settings.json'),
  JSON.stringify({
    schemaVersion: 1,
    profiles: [
      { id: 'echo-prof', name: 'Echo', baseShellId: 'pwsh', startupCommands: ['echo STARTUP_MARK_77'], restoreCommands: ['echo RESTORE_MARK_77'] },
    ],
    defaultProfileId: 'echo-prof',
    restoreSession: true,
    restorePathOnly: true,
  }),
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const result = {};

async function launch() {
  const app = await electron.launch({ executablePath: electronPath, args: [mainJs, `--user-data-dir=${userDataDir}`] });
  let win = null;
  for (let i = 0; i < 30 && !win; i++) {
    for (const w of app.windows()) if (await w.locator('#app').count().catch(() => 0)) { win = w; break; }
    if (!win) await sleep(300);
  }
  return { app, win };
}
const rowsText = (win) => win.evaluate(() => [...document.querySelectorAll('.xterm-rows')].map((r) => r.innerText).join('\n'));
const waitFor = async (win, re, tries = 40) => {
  for (let i = 0; i < tries; i++) {
    if (re.test(await rowsText(win))) return true;
    await sleep(300);
  }
  return false;
};
async function finish(code) {
  console.log('RESULT ' + JSON.stringify(result, null, 2));
  rmSync(userDataDir, { recursive: true, force: true });
  process.exit(code);
}

try {
  // Launch 1: a FRESH default spawn runs the startup sequence (restorePathOnly only affects restore).
  let { app, win } = await launch();
  if (!win) { result.error = 'no window (launch 1)'; await finish(1); }
  await win.getByRole('button', { name: 'New terminal' }).click();
  result.launch1_startupRan = await waitFor(win, /STARTUP_MARK_77/);
  await sleep(900); // let the debounced session save land
  await app.close().catch(() => {});

  // Launch 2: the pane is RESTORED — with restorePathOnly, no command sequence runs.
  ({ app, win } = await launch());
  if (!win) { result.error = 'no window (launch 2)'; await finish(1); }
  await sleep(2500); // let restore settle
  result.launch2_panes = await win.locator('[data-leaf-id]').count();
  // Prove the restored shell is ALIVE by running a fresh command.
  await win.locator('.xterm-screen').first().click();
  await sleep(150);
  await win.keyboard.type('echo LIVE_MARK_99');
  await win.keyboard.press('Enter');
  result.launch2_shellAlive = await waitFor(win, /LIVE_MARK_99/);
  const t2 = await rowsText(win);
  result.launch2_noStartup = !/STARTUP_MARK_77/.test(t2); // suppressed
  result.launch2_noRestore = !/RESTORE_MARK_77/.test(t2); // suppressed
  await app.close().catch(() => {});

  const ok =
    result.launch1_startupRan &&
    result.launch2_panes === 1 &&
    result.launch2_shellAlive &&
    result.launch2_noStartup &&
    result.launch2_noRestore;
  result.ok = ok;
  await finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  await finish(1);
}
