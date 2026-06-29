// Runtime verification of the custom colour picker + customizable colours. Open Settings -> Appearance,
// open the focused-pane-border picker, type a hex → the focused pane's border becomes that colour live;
// reset → back to the accent. Then set a status colour via the picker → the matching CSS var is set.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-appearance-colors');
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
const focusBorder = () =>
  win.evaluate(() => {
    const card = document.querySelector('.pane-focused .term-pane');
    return card ? getComputedStyle(card).borderColor : '';
  });
// open the picker popover for the Nth "Pick a colour" swatch, then type a hex into the picker's field
async function pickColor(swatchIndex, hex) {
  await win.locator('.settings-overlay button[aria-label="Pick a colour"]').nth(swatchIndex).click();
  await sleep(300);
  const hexInput = win.locator('.settings-overlay input[aria-label="Hex colour"]');
  if (!(await hexInput.count())) return false;
  await hexInput.fill(hex);
  await sleep(300);
  return true;
}
const openAppearance = async () => {
  await win.keyboard.press('Control+Comma');
  await sleep(500);
  await win.locator('.settings-overlay').getByText('Appearance', { exact: true }).click().catch(() => {});
  await sleep(300);
};

try {
  for (let i = 0; i < 30 && !win; i++) {
    for (const w of app.windows()) if (await w.locator('#app').count().catch(() => 0)) { win = w; break; }
    if (!win) await sleep(300);
  }
  if (!win) { result.error = 'no window'; await finish(1); }

  await win.getByRole('button', { name: 'New terminal' }).click();
  await sleep(900);
  result.defaultBorder = await focusBorder(); // accent (a blue), NOT red

  // Focus border via the custom picker → red.
  await openAppearance();
  result.pickerOpened = await pickColor(0, '#ff0000');
  await win.keyboard.press('Escape'); // close settings
  await sleep(400);
  result.afterSet = await focusBorder();

  // Reset focus border → back to the accent.
  await openAppearance();
  await win.locator('.settings-overlay').getByRole('button', { name: 'Default' }).first().click();
  await sleep(300);
  await win.keyboard.press('Escape');
  await sleep(400);
  result.afterReset = await focusBorder();

  // A status colour via the picker → the matching CSS var is set on <html>.
  await openAppearance();
  await pickColor(1, '#00ff00'); // the "Active" status swatch (after the focus swatch)
  result.statusVar = await win.evaluate(() => document.documentElement.style.getPropertyValue('--status-working').trim());

  // Orphan guard: close the modal (Escape) with a picker open, reopen → the picker must be gone.
  await win.keyboard.press('Escape');
  await sleep(400);
  await openAppearance();
  result.noOrphanPicker = (await win.locator('.settings-overlay input[aria-label="Hex colour"]').count()) === 0;
  await win.keyboard.press('Escape');

  const isRed = (c) => c.replace(/\s/g, '') === 'rgb(255,0,0)';
  const ok =
    result.pickerOpened &&
    result.defaultBorder &&
    !isRed(result.defaultBorder) &&
    isRed(result.afterSet) &&
    result.afterReset === result.defaultBorder &&
    result.statusVar === '#00ff00' &&
    result.noOrphanPicker;
  result.ok = ok;
  await finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  await finish(1);
}
