// Runtime verification of broadcast input. Split into two panes, turn on broadcast (via the command
// palette), type a marker in one pane and assert it lands in BOTH; then turn broadcast off and assert
// a second marker lands only in the focused pane.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-broadcast');
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
const paneText = (i) =>
  win.locator('[data-leaf-id]').nth(i).locator('.xterm-rows').first().innerText().catch(() => '');
const bothHave = async (marker) => {
  for (let i = 0; i < 30; i++) {
    const a = await paneText(0);
    const b = await paneText(1);
    if (a.includes(marker) && b.includes(marker)) return true;
    await sleep(200);
  }
  return false;
};
const runPaletteCmd = async (query) => {
  await win.keyboard.press('Control+Shift+P');
  await sleep(350);
  await win.keyboard.type(query);
  await sleep(300);
  await win.keyboard.press('Enter');
  await sleep(400);
};

try {
  for (let i = 0; i < 30 && !win; i++) {
    for (const w of app.windows()) if (await w.locator('#app').count().catch(() => 0)) { win = w; break; }
    if (!win) await sleep(300);
  }
  if (!win) { result.error = 'no window'; await finish(1); }

  await win.getByRole('button', { name: 'New terminal' }).click();
  await sleep(1000);
  await win.locator('.xterm-screen').first().click();
  await sleep(150);
  await win.keyboard.press('Alt+Shift+Equal'); // split → two panes
  await sleep(1200);
  result.paneCount = await win.locator('[data-leaf-id]').count();

  // Turn ON broadcast via the palette.
  await runPaletteCmd('broadcast');
  result.chipVisible = await win.locator('.statusbar__broadcast:visible').count();
  result.hostBroadcasting = await win.locator('.terminal-host.broadcasting').count();

  // Type in pane 0 → must appear in BOTH panes.
  await win.locator('[data-leaf-id]').nth(0).locator('.xterm-screen').click();
  await sleep(150);
  await win.keyboard.type('echo BCASTMARKER', { delay: 60 }); // human cadence (echoes settle between keys)
  await win.keyboard.press('Enter');
  result.broadcastReachedBoth = await bothHave('BCASTMARKER');

  // Turn OFF broadcast, then type in pane 1 → must appear ONLY there.
  await runPaletteCmd('broadcast');
  result.chipHiddenAfterOff = (await win.locator('.statusbar__broadcast:visible').count()) === 0;
  await win.locator('[data-leaf-id]').nth(1).locator('.xterm-screen').click();
  await sleep(150);
  await win.keyboard.type('echo SOLOMARKER');
  await win.keyboard.press('Enter');
  await sleep(1500);
  const p0 = await paneText(0);
  const p1 = await paneText(1);
  result.soloInFocused = p1.includes('SOLOMARKER');
  result.soloNotInOther = !p0.includes('SOLOMARKER');

  const ok =
    result.paneCount === 2 &&
    result.chipVisible >= 1 &&
    result.hostBroadcasting >= 1 &&
    result.broadcastReachedBoth &&
    result.chipHiddenAfterOff &&
    result.soloInFocused &&
    result.soloNotInOther;
  result.ok = ok;
  await finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  await finish(1);
}
