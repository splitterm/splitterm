// Runtime verification of rebindable keyboard shortcuts. Rebind "Split right" (default Alt+Shift+=)
// to Ctrl+Shift+D via Settings → Keyboard, confirm it persists, then prove the NEW chord splits and
// the OLD chord no longer does.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-keybindings');
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
const panes = () => win.locator('[data-leaf-id]').count();

try {
  for (let i = 0; i < 30 && !win; i++) {
    for (const w of app.windows()) if (await w.locator('#app').count().catch(() => 0)) { win = w; break; }
    if (!win) await sleep(300);
  }
  if (!win) { result.error = 'no window'; await finish(1); }

  // Open a terminal FIRST, so there's a pane that must NOT be closed during chord capture.
  await win.getByRole('button', { name: 'New terminal' }).click();
  await sleep(1000);
  result.panesBefore = await panes(); // 1

  // ---- Settings → Keyboard ----
  await win.getByRole('button', { name: 'Open settings' }).click();
  await sleep(300);
  await win.locator('.settings-dialog button[data-category="keyboard"]').click();
  await sleep(300);
  const splitBtn = win.locator('.settings-dialog button[aria-label="Split right shortcut"]');
  result.defaultLabel = (await splitBtn.textContent())?.trim();

  // CRITICAL (review HIGH): capturing a chord already bound to a tiling action (Close pane =
  // Ctrl+Shift+W) must NOT fire that action behind the modal, and must be rejected as a conflict.
  await splitBtn.click();
  await sleep(150);
  await win.keyboard.press('Control+Shift+KeyW');
  await sleep(250);
  result.panesDuringConflict = await panes(); // must still be 1 — pane NOT closed behind the modal
  result.splitRightAfterConflict = (await splitBtn.textContent())?.trim(); // unchanged (not reassigned)

  // Now rebind to a free chord (Ctrl+Shift+D).
  await splitBtn.click();
  await sleep(150);
  await win.keyboard.press('Control+Shift+KeyD');
  await sleep(200);
  result.newLabel = (await splitBtn.textContent())?.trim();
  result.persisted = await win.evaluate(async () => (await window.splitterm.settings.get()).keybindings.splitRight);
  await win.keyboard.press('Escape'); // close settings
  await sleep(300);

  // ---- Exercise the new vs old chord on the live terminal ----
  await win.locator('.xterm-screen').first().click();
  await sleep(150);
  await win.keyboard.press('Control+Shift+KeyD'); // the NEW split-right chord
  await sleep(1000);
  result.panesAfterNewChord = await panes();

  await win.keyboard.press('Alt+Shift+Equal'); // the OLD chord — now unbound, must do nothing
  await sleep(1000);
  result.panesAfterOldChord = await panes();

  const ok =
    result.panesBefore === 1 &&
    result.panesDuringConflict === 1 && // HIGH-bug fix: no destructive action behind the modal
    result.splitRightAfterConflict === 'Alt+Shift+=' && // conflict rejected (not reassigned)
    result.persisted === 'Ctrl+Shift+KeyD' &&
    result.newLabel === 'Ctrl+Shift+D' &&
    result.panesAfterNewChord === 2 &&
    result.panesAfterOldChord === 2; // old chord no longer splits
  result.ok = ok;
  await finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  await finish(1);
}
