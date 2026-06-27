// Runtime verification of the "Restore previous session" setting across three launches:
//   1. build a 2-pane layout (saved while restore is on), then turn the setting OFF, close.
//   2. relaunch (restore OFF) -> assert NOTHING restored (empty); turn it back ON, close.
//   3. relaunch (restore ON) -> assert the original 2-pane layout came back.
// This proves restore is gated AND that a restore-off (or empty) launch never clobbers the saved
// layout. Complements verify-session.mjs (default-on restore).
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-restore-setting');
rmSync(userDataDir, { recursive: true, force: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const result = {};

const launch = () =>
  electron.launch({ executablePath: electronPath, args: [mainJs, `--user-data-dir=${userDataDir}`] });
async function findWindow(app) {
  for (let i = 0; i < 30; i++) {
    for (const w of app.windows()) {
      if (await w.locator('#app').count().catch(() => 0)) return w;
    }
    await sleep(300);
  }
  return null;
}
function finish(code) {
  console.log('RESULT ' + JSON.stringify(result, null, 2));
  rmSync(userDataDir, { recursive: true, force: true });
  process.exit(code);
}
// Open Settings → General and flip the "Restore previous session" switch; returns its new state.
async function toggleRestore(win) {
  await win.getByRole('button', { name: 'Open settings' }).click();
  await sleep(300);
  await win.locator('.settings-dialog button[data-category="general"]').click();
  await sleep(300);
  await win.locator('.settings-dialog button[role="switch"]').first().click();
  await sleep(300);
  const v = await win.evaluate(async () => (await window.splitterm.settings.get()).restoreSession);
  await win.keyboard.press('Escape');
  await sleep(300);
  return v;
}

try {
  // ---- Launch 1: two panes (saved while restore is on by default), then turn restore OFF ----
  let app = await launch();
  let win = await findWindow(app);
  if (!win) {
    result.error = 'no window (launch 1)';
    await app.close().catch(() => {});
    finish(1);
  }
  await win.getByRole('button', { name: 'New terminal' }).click();
  await sleep(900);
  await win.locator('.xterm-screen').first().click();
  await sleep(150);
  await win.keyboard.press('Alt+Shift+Equal'); // split → 2 panes
  await sleep(1200); // let the 2-pane layout save (restore is on)
  result.panesBeforeClose = await win.locator('[data-leaf-id]').count();
  result.turnedOff = (await toggleRestore(win)) === false;
  await sleep(500);
  await app.close();
  await sleep(500);

  // ---- Launch 2: restore OFF → nothing restored; turn it back ON ----
  app = await launch();
  win = await findWindow(app);
  await sleep(1500);
  result.panesWhileOff = await win.locator('[data-leaf-id]').count(); // expect 0
  result.turnedOn = (await toggleRestore(win)) === true;
  await sleep(500);
  await app.close(); // empty window + restore just re-enabled → must NOT save empty over the layout
  await sleep(500);

  // ---- Launch 3: restore ON → the original 2-pane layout survived and reopens ----
  app = await launch();
  win = await findWindow(app);
  let restored = 0;
  for (let i = 0; i < 25; i++) {
    restored = await win.locator('[data-leaf-id]').count();
    if (restored >= 2) break;
    await sleep(300);
  }
  result.panesAfterReenable = restored;
  await app.close().catch(() => {});

  const ok =
    result.panesBeforeClose === 2 &&
    result.turnedOff &&
    result.panesWhileOff === 0 &&
    result.turnedOn &&
    result.panesAfterReenable === 2;
  finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  finish(1);
}
