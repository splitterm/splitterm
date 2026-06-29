// Runtime verification of the new tiling shortcuts: Equalize panes (resets split ratios to even) and
// Focus next (cycles focus). Split into two even panes, drag the gutter uneven, press Equalize → even
// again, then press Focus-next → focus moves to the other pane.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-tiling-shortcuts');
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
const widths = () =>
  win.evaluate(() => [...document.querySelectorAll('[data-leaf-id]')].map((c) => Math.round(c.getBoundingClientRect().width)));
const focusedId = () =>
  win.evaluate(() => document.querySelector('.pane-focused[data-leaf-id]')?.getAttribute('data-leaf-id') ?? '');

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
  await win.keyboard.press('Alt+Shift+Equal'); // split right → two even panes
  await sleep(1200);
  result.widthsEven = await widths();

  // Drag the column gutter right to make the panes uneven.
  const gb = await win.locator('[data-gutter="row"]').first().boundingBox();
  if (!gb) { result.error = 'no gutter'; await finish(1); }
  await win.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await win.mouse.down();
  await win.mouse.move(gb.x + gb.width / 2 + 140, gb.y + gb.height / 2, { steps: 10 });
  await win.mouse.up();
  await sleep(700);
  result.widthsUneven = await widths();

  // Equalize → even again.
  await win.keyboard.press('Alt+Shift+KeyE');
  await sleep(900);
  result.widthsAfterEqualize = await widths();

  // Focus next → focus moves to the other pane.
  result.focusedBefore = await focusedId();
  await win.keyboard.press('Alt+BracketRight');
  await sleep(400);
  result.focusedAfter = await focusedId();

  const even = (ws) => ws.length === 2 && Math.abs(ws[0] - ws[1]) <= 10;
  const uneven = (ws) => ws.length === 2 && Math.abs(ws[0] - ws[1]) > 40;
  const ok =
    even(result.widthsEven) &&
    uneven(result.widthsUneven) &&
    even(result.widthsAfterEqualize) &&
    !!result.focusedBefore &&
    !!result.focusedAfter &&
    result.focusedBefore !== result.focusedAfter;
  result.ok = ok;
  await finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  await finish(1);
}
