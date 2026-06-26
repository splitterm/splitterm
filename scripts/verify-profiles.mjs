// Runtime verification of custom profiles. Launches the built app with an isolated userData dir,
// creates a profile in the sidebar (base shell + startup command), then confirms it shows in the
// new-terminal dropdown, spawns with the right title, and actually runs the startup command.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-userdata');
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

  // 1) Open the sidebar and create a "Claude" profile (echo so we can see the command run).
  await win.getByRole('button', { name: 'Toggle sidebar' }).click();
  await sleep(400);
  await win.locator('input[placeholder^="Name"]').fill('Claude');
  const shellSel = win.locator('select');
  const optionValues = await shellSel.locator('option').evaluateAll((os2) => os2.map((o) => o.value));
  result.shellOptions = optionValues;
  if (optionValues[0]) await shellSel.selectOption(optionValues[0]);
  await win.locator('input[placeholder^="Startup"]').fill('echo splitterm-marker');
  await win.getByRole('button', { name: 'Add profile' }).click();
  await sleep(600);
  result.profileListedInSidebar = (await win.locator('.sidebar-inner').getByText('Claude', { exact: true }).count()) > 0;

  // Close the sidebar so its push layout can't intercept the dropdown.
  await win.getByRole('button', { name: 'Toggle sidebar' }).click();
  await sleep(400);

  // 2) Open the ▾ dropdown and confirm the profile is listed.
  await win.getByRole('button', { name: 'Choose terminal profile' }).click();
  await sleep(500);
  const claudeItem = win.locator('button').filter({ hasText: 'Claude' });
  result.dropdownClaudeCount = await claudeItem.count();
  result.profileInDropdown = result.dropdownClaudeCount > 0;

  if (result.profileInDropdown) {
    // 3) Launch it and verify the pane title + that the startup command ran.
    await claudeItem.first().click({ timeout: 5000 });
    await sleep(800);
    result.paneCount = await win.locator('[data-leaf-id]').count();
    result.titleShown = (await win.locator('.pane-title', { hasText: 'Claude' }).count()) > 0;

    let rowsText = '';
    for (let i = 0; i < 30; i++) {
      rowsText = await win.locator('.xterm-rows').first().innerText().catch(() => '');
      if (/splitterm-marker/.test(rowsText)) break;
      await sleep(300);
    }
    result.commandRan = /splitterm-marker/.test(rowsText);
    result.rowsSample = rowsText.slice(0, 400);
  }

  await finish(0);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  if (win) await win.screenshot({ path: path.resolve('scripts/verify-profiles-fail.png') }).catch(() => {});
  await finish(1);
}
