// Runtime verification that the "Shell integration" setting GATES the PowerShell OSC 7 shim. Turn it
// OFF, open a terminal, `cd C:\Windows`, split — and the new pane should NOT inherit the cwd (no OSC 7
// is emitted, so the tracked cwd stays the spawn dir). The on path (default → inherits) is in
// verify-cwd-split.mjs; together they prove the setting controls the shim end-to-end.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-shell-integration');
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

  // Turn shell integration OFF (Settings → Terminal) BEFORE opening a terminal, so the next spawn
  // gets no OSC 7 shim.
  await win.getByRole('button', { name: 'Open settings' }).click();
  await sleep(300);
  await win.locator('.settings-dialog button[data-category="terminal"]').click();
  await sleep(300);
  const sw = win.locator('.settings-dialog button[role="switch"][aria-label="Shell integration"]'); // row() sets aria-label from the label
  result.defaultOn = (await sw.getAttribute('aria-checked')) === 'true';
  if (result.defaultOn) await sw.click();
  await sleep(200);
  result.persistedOff = (await win.evaluate(async () => (await window.splitterm.settings.get()).terminal.shellIntegration)) === false;
  await win.keyboard.press('Escape');
  await sleep(300);

  // Open a terminal (shim off), cd, and split — the new pane must NOT inherit C:\Windows.
  await win.getByRole('button', { name: 'New terminal' }).click();
  await sleep(1000);
  await win.locator('.xterm-screen').first().click();
  await sleep(150);
  await win.keyboard.type('cd C:\\Windows');
  await win.keyboard.press('Enter');
  for (let i = 0; i < 30; i++) {
    if ((await countPanesMatching(/PS C:\\Windows/)) >= 1) break;
    await sleep(300);
  }
  await sleep(500);
  await win.keyboard.press('Alt+Shift+Equal');
  await sleep(1500);
  result.paneCount = await win.locator('[data-leaf-id]').count();

  // Only the pane that actually cd'd shows the C:\Windows prompt; the split fell back to the spawn
  // dir (home). With the shim on this would be 2. Wait generously so a slow second-pane spawn can't
  // make this look like "1" before its (home) prompt even renders.
  await sleep(3000);
  result.panesInWindows = await countPanesMatching(/PS C:\\Windows/);

  const ok = result.defaultOn && result.persistedOff && result.paneCount === 2 && result.panesInWindows === 1;
  await finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  if (win) await win.screenshot({ path: path.resolve('scripts/verify-shell-integration-fail.png') }).catch(() => {});
  await finish(1);
}
