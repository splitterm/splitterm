// Runtime verification of the customizable focused-pane border colour. Open Settings -> Appearance,
// pick a distinct colour, and assert the focused pane's border becomes that colour live; then reset to
// default and assert it returns to the theme accent.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-focus-color');
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
// the border colour of the focused pane's card
const focusBorder = () =>
  win.evaluate(() => {
    const card = document.querySelector('.pane-focused .term-pane');
    return card ? getComputedStyle(card).borderColor : '';
  });
const setColor = (hex) =>
  win.evaluate((h) => {
    const input = document.querySelector('.settings-overlay input[type="color"]');
    if (!input) return false;
    input.value = h;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, hex);

try {
  for (let i = 0; i < 30 && !win; i++) {
    for (const w of app.windows()) if (await w.locator('#app').count().catch(() => 0)) { win = w; break; }
    if (!win) await sleep(300);
  }
  if (!win) { result.error = 'no window'; await finish(1); }

  await win.getByRole('button', { name: 'New terminal' }).click();
  await sleep(900);
  result.defaultBorder = await focusBorder(); // theme accent (a blue), NOT red

  // Open settings → Appearance and set a distinct focus colour.
  await win.keyboard.press('Control+Comma');
  await sleep(500);
  await win.locator('.settings-overlay').getByText('Appearance', { exact: true }).click().catch(() => {});
  await sleep(300);
  result.foundColorInput = await setColor('#ff0000');
  await sleep(300);
  await win.keyboard.press('Escape'); // close settings
  await sleep(400);
  result.afterSet = await focusBorder();

  // Reset to default → back to the accent.
  await win.keyboard.press('Control+Comma');
  await sleep(400);
  await win.locator('.settings-overlay').getByText('Appearance', { exact: true }).click().catch(() => {});
  await sleep(300);
  await win.locator('.settings-overlay').getByRole('button', { name: 'Default' }).first().click();
  await sleep(300);
  await win.keyboard.press('Escape');
  await sleep(400);
  result.afterReset = await focusBorder();

  const isRed = result.afterSet.replace(/\s/g, '') === 'rgb(255,0,0)';
  const resetMatchesDefault = result.afterReset === result.defaultBorder;
  result.isRed = isRed;
  result.resetMatchesDefault = resetMatchesDefault;
  const ok = result.foundColorInput && result.defaultBorder && !isRedDefault(result.defaultBorder) && isRed && resetMatchesDefault;
  result.ok = ok;
  await finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  await finish(1);
}

function isRedDefault(c) {
  return c.replace(/\s/g, '') === 'rgb(255,0,0)';
}
