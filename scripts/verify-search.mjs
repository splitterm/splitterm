// Runtime verification of per-pane scrollback search. Launches the built app with an isolated
// userData dir, opens a terminal, prints a known needle, then Ctrl+F → types the needle and asserts
// the search bar opens, the match count reports a hit, and Escape closes the bar.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-search');
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

const NEEDLE = 'splitterm-search-needle';

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

  // Open a terminal and print the needle so it's in the scrollback.
  await win.getByRole('button', { name: 'New terminal' }).click();
  await sleep(800);
  result.paneCount = await win.locator('[data-leaf-id]').count();

  await win.locator('.xterm-screen').first().click(); // focus the xterm
  await sleep(150);
  await win.keyboard.type(`echo ${NEEDLE}`);
  await win.keyboard.press('Enter');
  // Wait for the echoed output to land in the buffer.
  for (let i = 0; i < 30; i++) {
    const txt = await win.locator('.xterm-rows').first().innerText().catch(() => '');
    if ((txt.match(new RegExp(NEEDLE, 'g')) || []).length >= 2) break;
    await sleep(200);
  }

  // Ctrl+F opens the per-pane search bar.
  await win.locator('.xterm-screen').first().click();
  await sleep(150);
  await win.keyboard.press('Control+f');
  await sleep(300);
  result.searchBarVisible = await win.locator('.term-search').first().isVisible().catch(() => false);

  // Type the needle and read the match count (driven by the addon's onDidChangeResults).
  await win.locator('.term-search input').first().fill(NEEDLE);
  await sleep(500);
  const countText = await win.locator('.term-search-count').first().innerText().catch(() => '');
  result.countText = countText;
  const m = /^(\d+)\/(\d+)$/.exec(countText.trim());
  result.matchTotal = m ? Number(m[2]) : 0;
  result.foundMatches = result.matchTotal >= 1;

  // Escape closes the bar.
  await win.locator('.term-search input').first().press('Escape');
  await sleep(300);
  result.searchBarHiddenAfterEscape = !(await win.locator('.term-search').first().isVisible().catch(() => true));

  // Reopen, then click the bar's own X — it must close the search, NOT the pane beneath it (the pane
  // close button shares the top-right corner, so the bar's stacking must win the hit-test).
  await win.locator('.xterm-screen').first().click();
  await sleep(150);
  await win.keyboard.press('Control+f');
  await sleep(300);
  await win.locator('.term-search button[aria-label="Close (Escape)"]').first().click();
  await sleep(300);
  result.paneSurvivedXClick = (await win.locator('[data-leaf-id]').count()) === result.paneCount;
  result.searchBarHiddenAfterX = !(await win.locator('.term-search').first().isVisible().catch(() => true));

  const ok =
    result.searchBarVisible &&
    result.foundMatches &&
    result.searchBarHiddenAfterEscape &&
    result.paneSurvivedXClick &&
    result.searchBarHiddenAfterX;
  await finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  if (win) await win.screenshot({ path: path.resolve('scripts/verify-search-fail.png') }).catch(() => {});
  await finish(1);
}
