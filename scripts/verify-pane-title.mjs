// Runtime verification of dynamic pane titles: when the shell reports a title via OSC 0/2, the pane's
// title chip (and the Sessions sidebar) show it live. Open a terminal, have PowerShell emit
// `ESC ]2;<title> BEL`, and assert the .pane-title chip picks it up.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-pane-title');
rmSync(userDataDir, { recursive: true, force: true });

const TITLE = 'DYNTITLE_99';
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
const chipText = () =>
  win.evaluate(() => [...document.querySelectorAll('.pane-title')].map((c) => c.textContent ?? '').join('|'));

try {
  for (let i = 0; i < 30 && !win; i++) {
    for (const w of app.windows()) if (await w.locator('#app').count().catch(() => 0)) { win = w; break; }
    if (!win) await sleep(300);
  }
  if (!win) { result.error = 'no window'; await finish(1); }

  await win.getByRole('button', { name: 'New terminal' }).click();
  await sleep(1200);
  // Baseline: a default "+" terminal may already show a shell-provided startup title (PowerShell
  // under ConPTY often sets one), so don't require zero chips — assert the delta below instead.
  result.baselineChip = await chipText();

  // Make PowerShell emit an OSC 2 title sequence (ESC ]2;TITLE BEL).
  await win.locator('.xterm-screen').first().click();
  await sleep(150);
  await win.keyboard.type(`[Console]::Write([char]27 + ']2;${TITLE}' + [char]7)`);
  await win.keyboard.press('Enter');

  for (let i = 0; i < 30; i++) {
    if ((await chipText()).includes(TITLE)) break;
    await sleep(300);
  }
  await sleep(300);
  result.chip = await chipText();
  result.chipShowsTitle = result.chip.includes(TITLE); // the shell's OSC title drove the chip live

  const ok = result.chipShowsTitle;
  result.ok = ok;
  await finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  await finish(1);
}
