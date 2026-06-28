// Runtime verification of cwd-on-split. With shell integration on (the default), a stock PowerShell
// pane reports its cwd via OSC 7, so: open a terminal, `cd C:\Windows`, split — and the new pane
// opens in C:\Windows (its prompt shows it). This exercises OSC 7 (from the integrated prompt) →
// PaneHandle.cwd → split → spawn cwd end-to-end. The off path (setting disabled) is in
// verify-shell-integration.mjs.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-cwd');
rmSync(userDataDir, { recursive: true, force: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = await electron.launch({ executablePath: electronPath, args: [mainJs, `--user-data-dir=${userDataDir}`] });

const result = {};
let win = null;

async function finish(code) {
  console.log('RESULT ' + JSON.stringify(result, null, 2));
  await app.close().catch(() => {});
  rmSync(userDataDir, { recursive: true, force: true });
  process.exit(code);
}
const countPanesMatching = async (re) => {
  const rows = win.locator('.xterm-rows');
  const n = await rows.count();
  let c = 0;
  for (let i = 0; i < n; i++) {
    const t = await rows.nth(i).innerText().catch(() => '');
    if (re.test(t)) c++;
  }
  return c;
};

try {
  for (let i = 0; i < 30 && !win; i++) {
    for (const w of app.windows()) {
      if (await w.locator('#app').count().catch(() => 0)) {
        win = w;
        break;
      }
    }
    if (!win) await sleep(300);
  }
  if (!win) {
    result.error = 'no app window';
    await finish(1);
  }

  await win.getByRole('button', { name: 'New terminal' }).click();
  await sleep(1000);
  await win.locator('.xterm-screen').first().click();
  await sleep(150);

  // cd into a known dir; the integrated prompt reports it via OSC 7 (no manual escape needed).
  await win.keyboard.type('cd C:\\Windows');
  await win.keyboard.press('Enter');
  for (let i = 0; i < 30; i++) {
    if ((await countPanesMatching(/PS C:\\Windows/)) >= 1) break;
    await sleep(300);
  }
  result.firstPaneInWindows = (await countPanesMatching(/PS C:\\Windows/)) >= 1;
  await sleep(500); // let the OSC 7 for the new cwd be fully processed before splitting

  // Split — the new pane should inherit the tracked cwd (C:\Windows).
  await win.keyboard.press('Alt+Shift+Equal');
  await sleep(1500);
  result.paneCount = await win.locator('[data-leaf-id]').count();

  // Both panes show the "PS C:\Windows>" prompt (the typed `cd` command has no "PS " prefix, so it
  // can't false-match). If the split fell back to home, only the first pane would match. Generous
  // retry: spawning PowerShell + its first prompt can be slow when the e2e suite runs under load.
  let both = 0;
  for (let i = 0; i < 40; i++) {
    both = await countPanesMatching(/PS C:\\Windows/);
    if (both >= 2) break;
    await sleep(300);
  }
  result.panesInWindows = both;

  const ok = result.firstPaneInWindows && result.paneCount === 2 && result.panesInWindows === 2;
  await finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  if (win) await win.screenshot({ path: path.resolve('scripts/verify-cwd-split-fail.png') }).catch(() => {});
  await finish(1);
}
