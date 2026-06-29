// Runtime verification of the Claude-working sidebar status. Claude Code shows an "esc to interrupt"
// hint on screen only while processing; we detect it and surface a prominent 'claudeWorking' status.
// Put that hint on screen → assert the pane reads claudeWorking + the row is highlighted; clear the
// screen → assert it reverts (so your own typing is never mistaken for Claude working).
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-claude-status');
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
const statusOf = () => win.evaluate(() => document.querySelector('.pane-status-dot')?.getAttribute('data-status') ?? '');
const rowHighlighted = () => win.evaluate(() => document.querySelectorAll('.row-claude-working').length);
const waitStatus = async (want, tries) => {
  for (let i = 0; i < tries; i++) {
    if ((await statusOf()) === want) return true;
    await sleep(150);
  }
  return false;
};

try {
  for (let i = 0; i < 30 && !win; i++) {
    for (const w of app.windows()) if (await w.locator('#app').count().catch(() => 0)) { win = w; break; }
    if (!win) await sleep(300);
  }
  if (!win) { result.error = 'no window'; await finish(1); }

  await win.getByRole('button', { name: 'Toggle sidebar' }).click();
  await sleep(300);
  await win.getByRole('button', { name: 'New terminal' }).click();
  await sleep(2200); // settle → idle (no hint)
  result.statusInitial = await statusOf();

  // Put Claude's "esc to interrupt" hint on screen.
  await win.locator('.xterm-screen').first().click();
  await sleep(150);
  await win.keyboard.type('Write-Host "working... (esc to interrupt)"');
  await win.keyboard.press('Enter');
  result.claudeDetected = await waitStatus('claudeWorking', 25);
  result.rowHighlighted = await rowHighlighted();

  // Clear the screen → hint gone → reverts out of claudeWorking.
  await win.keyboard.type('Clear-Host');
  await win.keyboard.press('Enter');
  await sleep(1800);
  result.clearedStatus = await statusOf();

  const ok =
    result.statusInitial !== 'claudeWorking' &&
    result.claudeDetected &&
    result.rowHighlighted >= 1 &&
    result.clearedStatus !== 'claudeWorking';
  result.ok = ok;
  await finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  await finish(1);
}
