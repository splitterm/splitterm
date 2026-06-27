// Runtime verification that a keyboard split inherits the focused pane's profile (not the default).
// Create a "Claude" profile whose startup command prints a marker, launch it, split the pane, and
// assert BOTH panes ran the command (the split re-ran the inherited profile) and the new pane carries
// the "Claude" title.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-split-inherit');
rmSync(userDataDir, { recursive: true, force: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = await electron.launch({ executablePath: electronPath, args: [mainJs, `--user-data-dir=${userDataDir}`] });

const result = {};
let win = null;
const MARKER = 'split-inherit-marker';

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

  // 1) Create a "Claude" profile with a marker-printing startup command.
  await win.getByRole('button', { name: 'Open settings' }).click();
  await sleep(300);
  await win.locator('.settings-dialog button[data-category="profiles"]').click();
  await sleep(300);
  await win.locator('.settings-dialog input[placeholder^="Name"]').fill('Claude');
  const shellSel = win.locator('.settings-dialog form select'); // add-form shell select
  const optionValues = await shellSel.locator('option').evaluateAll((os2) => os2.map((o) => o.value));
  if (optionValues[0]) await shellSel.selectOption(optionValues[0]);
  await win.locator('.settings-dialog input[placeholder^="Startup"]').fill(`echo ${MARKER}`);
  await win.getByRole('button', { name: 'Add profile' }).click();
  await sleep(400);
  await win.keyboard.press('Escape'); // close modal
  await sleep(300);

  // 2) Launch the Claude profile from the ▾ dropdown.
  await win.getByRole('button', { name: 'Choose terminal profile' }).click();
  await sleep(500);
  await win.locator('button').filter({ hasText: 'Claude' }).first().click({ timeout: 5000 });
  await sleep(800);
  // Wait until the first pane has run the startup command.
  for (let i = 0; i < 30; i++) {
    if ((await countPanesMatching(new RegExp(MARKER))) >= 1) break;
    await sleep(300);
  }
  result.markerPanesBeforeSplit = await countPanesMatching(new RegExp(MARKER));

  // 3) Split the focused pane — it should inherit the Claude profile and re-run the command.
  await win.locator('.xterm-screen').first().click();
  await sleep(150);
  await win.keyboard.press('Alt+Shift+Equal');
  await sleep(1200);
  result.paneCount = await win.locator('[data-leaf-id]').count();

  let markerPanes = 0;
  for (let i = 0; i < 25; i++) {
    markerPanes = await countPanesMatching(new RegExp(MARKER));
    if (markerPanes >= 2) break;
    await sleep(300);
  }
  result.markerPanesAfterSplit = markerPanes;
  // Both panes should carry the inherited "Claude" title chip.
  result.claudeTitleChips = await win.locator('.pane-title', { hasText: 'Claude' }).count();

  const ok =
    result.markerPanesBeforeSplit === 1 &&
    result.paneCount === 2 &&
    result.markerPanesAfterSplit === 2 &&
    result.claudeTitleChips === 2;
  await finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  if (win) await win.screenshot({ path: path.resolve('scripts/verify-split-inherit-fail.png') }).catch(() => {});
  await finish(1);
}
