// Runtime verification of session restore. Launch 1: open a terminal, split it (Alt+Shift+=) to get
// two panes, let the layout persist, then close the app. Launch 2: reuse the SAME userData dir and
// assert the two-pane layout was restored on launch. Proves serialize → session.json → normalize →
// restore end-to-end.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync, existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-session');
rmSync(userDataDir, { recursive: true, force: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const result = {};

async function launch() {
  return electron.launch({ executablePath: electronPath, args: [mainJs, `--user-data-dir=${userDataDir}`] });
}
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

try {
  // ---- Launch 1: build a two-pane layout, then close ----
  let app = await launch();
  let win = await findWindow(app);
  if (!win) {
    result.error = 'no window (launch 1)';
    await app.close().catch(() => {});
    finish(1);
  }
  await win.getByRole('button', { name: 'New terminal' }).click();
  await sleep(900);
  await win.locator('.xterm-screen').first().click(); // focus a pane
  await sleep(150);
  await win.keyboard.press('Alt+Shift+Equal'); // split the focused pane → 2 panes
  await sleep(1000);
  result.panesBeforeClose = await win.locator('[data-leaf-id]').count();
  await sleep(800); // let the debounced save (renderer 400ms + main 250ms) land
  await app.close(); // triggers pagehide save + before-quit flush
  await sleep(500);
  result.sessionFileWritten = existsSync(path.join(userDataDir, 'session.json'));

  // ---- Launch 2: same userData → the layout should restore ----
  app = await launch();
  win = await findWindow(app);
  if (!win) {
    result.error = 'no window (launch 2)';
    await app.close().catch(() => {});
    finish(1);
  }
  let restored = 0;
  for (let i = 0; i < 25; i++) {
    restored = await win.locator('[data-leaf-id]').count();
    if (restored >= 2) break;
    await sleep(300);
  }
  result.panesAfterRestore = restored;
  await app.close().catch(() => {});

  const ok = result.panesBeforeClose === 2 && result.sessionFileWritten && result.panesAfterRestore === 2;
  finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  finish(1);
}
