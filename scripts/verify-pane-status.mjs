// Runtime verification of the per-pane activity status in the Sessions sidebar. Open a terminal, then
// drive its status through the firehose-derived states: idle (quiet) → working (sustained output) →
// idle → attention (the shell rings the bell). Read the sidebar dot's data-status.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-pane-status');
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

  await win.getByRole('button', { name: 'Toggle sidebar' }).click(); // show the Sessions list
  await sleep(300);
  await win.getByRole('button', { name: 'New terminal' }).click();
  await sleep(2200); // shell prints its prompt then goes quiet
  result.idleInitial = await statusOf();

  // A short output burst → working (the 1.2s idle timer keeps it 'working' for a couple seconds).
  await win.locator('.xterm-screen').first().click();
  await sleep(150);
  await win.keyboard.type('1..15 | % { $_; Start-Sleep -Milliseconds 70 }');
  await win.keyboard.press('Enter');
  result.sawWorking = await waitStatus('working', 25);

  // Let the burst finish + the idle timer elapse → idle (fixed settle, not a race with the loop).
  await sleep(4000);
  result.idleAfter = await statusOf();

  // Ring the bell → attention (the shell signalled it wants you); echo→working then quiet→attention.
  await win.keyboard.type('[Console]::Write([char]7)');
  await win.keyboard.press('Enter');
  await sleep(3000);
  result.attentionAfterBell = await statusOf();

  // The user responds (types): attention clears, and the next quiet must be 'idle', NOT a sticky
  // 'attention' from the earlier bell (regression guard for the belled-flag reset fix).
  await win.keyboard.type('echo responded');
  await win.keyboard.press('Enter');
  await sleep(4000);
  result.idleAfterResponse = await statusOf();

  const ok =
    result.idleInitial === 'idle' &&
    result.sawWorking &&
    result.idleAfter === 'idle' &&
    result.attentionAfterBell === 'attention' &&
    result.idleAfterResponse === 'idle';
  result.ok = ok;
  await finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  await finish(1);
}
