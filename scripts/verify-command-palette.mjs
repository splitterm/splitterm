// Runtime verification of the command palette (Ctrl+Shift+P): opens with the input focused, lists
// every action, filters by query, runs the selected command (Enter) — here "Split right", which must
// split the pane — closes after running, and closes again on Escape.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-command-palette');
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
const openCount = () => win.locator('.command-palette-overlay.open').count();
const itemTitles = () =>
  win.locator('.command-palette-item').evaluateAll((els) => els.map((e) => e.querySelector('span')?.textContent ?? ''));

try {
  for (let i = 0; i < 30 && !win; i++) {
    for (const w of app.windows()) if (await w.locator('#app').count().catch(() => 0)) { win = w; break; }
    if (!win) await sleep(300);
  }
  if (!win) { result.error = 'no window'; await finish(1); }

  await win.getByRole('button', { name: 'New terminal' }).click();
  await sleep(1000);
  result.paneBefore = await win.locator('[data-leaf-id]').count();
  await win.locator('.xterm-screen').first().click();
  await sleep(150);

  // Open the palette.
  await win.keyboard.press('Control+Shift+P');
  await sleep(400);
  result.openVisible = await openCount();
  result.inputFocused = await win.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Filter commands');
  result.itemCountAll = (await itemTitles()).length;

  // Filter to the split commands.
  await win.keyboard.type('split');
  await sleep(300);
  const split = await itemTitles();
  result.splitTitles = split;
  result.allAreSplit = split.length > 0 && split.every((t) => t.toLowerCase().includes('split'));

  // Enter runs the first match ("Split right") → splits the pane and closes the palette.
  await win.keyboard.press('Enter');
  await sleep(900);
  result.closedAfterRun = (await openCount()) === 0;
  result.paneAfter = await win.locator('[data-leaf-id]').count();

  // Re-open, then Escape closes.
  await win.keyboard.press('Control+Shift+P');
  await sleep(300);
  result.reopened = await openCount();
  await win.keyboard.press('Escape');
  await sleep(300);
  result.closedAfterEscape = (await openCount()) === 0;

  // Mutual exclusion: Ctrl+, with the palette open closes it and opens settings (never stacks).
  await win.keyboard.press('Control+Shift+P');
  await sleep(300);
  await win.keyboard.press('Control+Comma');
  await sleep(400);
  result.paletteClosedForSettings = (await openCount()) === 0;
  result.settingsOpened = await win.locator('.settings-overlay.open').count();
  await win.keyboard.press('Escape');
  await sleep(300);

  const ok =
    result.openVisible >= 1 &&
    result.inputFocused &&
    result.itemCountAll > 10 &&
    result.allAreSplit &&
    result.closedAfterRun &&
    result.paneAfter === result.paneBefore + 1 &&
    result.reopened >= 1 &&
    result.closedAfterEscape &&
    result.paletteClosedForSettings &&
    result.settingsOpened >= 1;
  result.ok = ok;
  await finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  await finish(1);
}
