// Runtime verification of custom profiles via the settings modal. Launches the built app with an
// isolated userData dir, creates a "Claude" profile in Settings → Profiles (base shell + startup
// command), sets it as the "+" default, then confirms it persists, shows in the new-terminal
// dropdown, and that pressing "+" opens it (right title + the startup command actually runs).
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-profiles');
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

  // 1) Open Settings → Profiles and create a "Claude" profile (echo so we can see the command run).
  await win.getByRole('button', { name: 'Open settings' }).click();
  await sleep(300);
  await win.locator('.settings-dialog button[data-category="profiles"]').click();
  await sleep(300);
  await win.locator('.settings-dialog input[placeholder^="Name"]').fill('Claude');
  // The add-form shell select (the default-profile picker + the status Animation selects are separate).
  const shellSel = win.locator('.settings-dialog form select[aria-label="Base shell"]');
  const optionValues = await shellSel.locator('option').evaluateAll((os2) => os2.map((o) => o.value));
  result.shellOptions = optionValues;
  if (optionValues[0]) await shellSel.selectOption(optionValues[0]);
  await win.locator('.settings-dialog textarea[aria-label="Startup commands"]').fill('echo splitterm-marker');
  await win.getByRole('button', { name: 'Add profile' }).click();
  await sleep(500);
  result.profileListedInModal = (await win.locator('.settings-dialog').getByText('Claude', { exact: true }).count()) > 0;

  // 2) Set "Claude" as the "+" default via the Profiles section's default-profile picker.
  await win.locator('.settings-dialog select[aria-label^="Default profile"]').selectOption({ label: 'Claude' });
  await sleep(300);
  const persisted = await win.evaluate(async () => {
    const s = await window.splitterm.settings.get();
    const claude = s.profiles.find((p) => p.name === 'Claude');
    return { defaultProfileId: s.defaultProfileId, claudeId: claude ? claude.id : null };
  });
  result.defaultSetToClaude = persisted.claudeId != null && persisted.defaultProfileId === persisted.claudeId;

  // Close the modal (Escape).
  await win.keyboard.press('Escape');
  await sleep(300);

  // 3) Confirm the profile is listed in the ▾ dropdown.
  await win.getByRole('button', { name: 'Choose terminal profile' }).click();
  await sleep(500);
  const claudeItem = win.locator('button').filter({ hasText: 'Claude' });
  result.dropdownClaudeCount = await claudeItem.count();
  result.profileInDropdown = result.dropdownClaudeCount > 0;
  await win.keyboard.press('Escape'); // close the dropdown without launching
  await sleep(200);

  // 4) Press "+" — it should open the default ("Claude"): right pane title + startup command runs.
  await win.getByRole('button', { name: 'New terminal' }).click();
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
  result.rowsSample = rowsText.slice(0, 300);

  await finish(0);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  if (win) await win.screenshot({ path: path.resolve('scripts/verify-profiles-fail.png') }).catch(() => {});
  await finish(1);
}
