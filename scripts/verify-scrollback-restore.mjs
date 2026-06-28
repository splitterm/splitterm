// Runtime verification of "Restore terminal history" (restoreScrollback). Pre-seeds settings.json with
// the opt-in on. Launch 1: open a terminal, echo a unique marker. Launch 2 (same user-data dir): the
// restored pane must REPLAY that marker (saved scrollback) as read-only history above a fresh shell —
// even though the shell itself is brand new and never ran the command.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-scrollback');
rmSync(userDataDir, { recursive: true, force: true });
mkdirSync(userDataDir, { recursive: true });
writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ schemaVersion: 1, restoreScrollback: true }));

const MARK = 'SCROLLBACK_MARK_77';
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
  for (let i = 0; i < tries; i++) { if (re.test(await rowsText(win))) return true; await sleep(300); }
  return false;
};
async function finish(code) {
  console.log('RESULT ' + JSON.stringify(result, null, 2));
  rmSync(userDataDir, { recursive: true, force: true });
  process.exit(code);
}

try {
  // ---- Launch 1: open a terminal and produce a unique line ----
  let { app, win } = await launch();
  if (!win) { result.error = 'no window (launch 1)'; await finish(1); }
  await win.getByRole('button', { name: 'New terminal' }).click();
  await sleep(1000);
  await win.locator('.xterm-screen').first().click();
  await sleep(150);
  await win.keyboard.type(`echo ${MARK}`);
  await win.keyboard.press('Enter');
  result.launch1_printed = await waitFor(win, new RegExp(MARK));
  await sleep(1200); // let output settle; the save on close (pagehide) captures the buffer
  await app.close().catch(() => {});

  // ---- Launch 2: the restored pane replays the saved scrollback ----
  ({ app, win } = await launch());
  if (!win) { result.error = 'no window (launch 2)'; await finish(1); }
  result.launch2_replayed = await waitFor(win, new RegExp(MARK));
  await sleep(500);
  result.launch2_panes = await win.locator('[data-leaf-id]').count();
  await app.close().catch(() => {});

  const ok = result.launch1_printed && result.launch2_replayed && result.launch2_panes === 1;
  result.ok = ok;
  await finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  await finish(1);
}
