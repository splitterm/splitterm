// Runtime verification that a terminal profile can be EDITED after creation. Open Settings -> Profiles,
// add a profile, click its pencil (edit), rename it, save, and assert the row reflects the new name
// (and the form returns to "add" mode).
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-profile-edit');
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
const ov = () => win.locator('.settings-overlay');
const rowsText = () => ov().locator('.flex.flex-col.gap-1 > div').allInnerTexts();

try {
  for (let i = 0; i < 30 && !win; i++) {
    for (const w of app.windows()) if (await w.locator('#app').count().catch(() => 0)) { win = w; break; }
    if (!win) await sleep(300);
  }
  if (!win) { result.error = 'no window'; await finish(1); }

  await win.keyboard.press('Control+Comma');
  await sleep(500);
  await ov().getByText('Profiles', { exact: true }).click();
  await sleep(400);

  // Add a profile.
  await ov().locator('input[aria-label="Profile name"]').fill('EditMe');
  await sleep(100);
  await ov().getByRole('button', { name: 'Add profile' }).click();
  await sleep(500);
  result.addedShows = (await rowsText()).some((t) => t.includes('EditMe'));

  // Edit it: pencil → form loads → rename → save.
  await ov().locator('button[title="Edit profile"]').first().click();
  await sleep(300);
  result.formLoaded = (await ov().locator('input[aria-label="Profile name"]').inputValue()) === 'EditMe';
  result.buttonSaysSave = await ov().getByRole('button', { name: 'Save changes' }).isVisible();
  await ov().locator('input[aria-label="Profile name"]').fill('Edited');
  await sleep(100);
  await ov().getByRole('button', { name: 'Save changes' }).click();
  await sleep(500);

  const rows = await rowsText();
  result.renamedShows = rows.some((t) => t.includes('Edited'));
  result.oldNameGone = !rows.some((t) => t.includes('EditMe'));
  result.backToAddMode = await ov().getByRole('button', { name: 'Add profile' }).isVisible();

  const ok = result.addedShows && result.formLoaded && result.buttonSaysSave && result.renamedShows && result.oldNameGone && result.backToAddMode;
  result.ok = ok;
  await finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  await finish(1);
}
