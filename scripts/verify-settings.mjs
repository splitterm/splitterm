// Runtime verification of the settings modal wiring. Launches the built app with an isolated
// userData dir, opens a terminal, then drives Settings → Appearance (theme + reduce-motion) and
// Settings → Terminal (font size), asserting the changes are persisted AND applied live (the
// <html data-theme> flips, CSS vars change, the xterm font updates).
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-settings');
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

  // Open one terminal so there's a live xterm to re-theme / re-font.
  await win.getByRole('button', { name: 'New terminal' }).click();
  await sleep(800);
  result.paneCount = await win.locator('[data-leaf-id]').count();

  // ---- Appearance: turn OFF "Sync with OS", pick OLED Black, enable reduce motion ----
  await win.getByRole('button', { name: 'Open settings' }).click();
  await sleep(300);
  await win.locator('.settings-dialog button[data-category="appearance"]').click(); // General opens by default now
  await sleep(300);
  const switches = win.locator('.settings-dialog button[role="switch"]'); // [0]=followOS, [1]=reduceMotion
  if ((await switches.nth(0).getAttribute('aria-checked')) === 'true') {
    await switches.nth(0).click(); // disable OS sync so the theme select is usable
    await sleep(150);
  }
  await win.locator('.settings-dialog select[aria-label="Theme"]').selectOption('OLED Black'); // not the status Animation selects
  await sleep(300);
  await switches.nth(1).click(); // reduce motion ON
  await sleep(300);

  result.themeAttr = await win.evaluate(() => document.documentElement.dataset.theme ?? '');
  result.reduceMotionAttr = await win.evaluate(() => document.documentElement.dataset.reduceMotion ?? '');
  result.bgApp = await win.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--bg-app').trim(),
  );

  // ---- Terminal: change font size to 20 ----
  await win.locator('.settings-dialog button[data-category="terminal"]').click();
  await sleep(300);
  const fontSize = win.locator('.settings-dialog input[type="number"]').first();
  await fontSize.fill('20');
  await fontSize.dispatchEvent('change');
  await sleep(500);

  // Read the size xterm actually measures with (its hidden measure element carries the live font).
  result.measuredFontSizes = await win.evaluate(() =>
    [...document.querySelectorAll('.xterm-char-measure-element, .xterm-rows, .xterm')].map((el) =>
      getComputedStyle(el).fontSize,
    ),
  );

  // Authoritative: the persisted settings snapshot (via the same IPC the renderer uses).
  result.persisted = await win.evaluate(async () => {
    const s = await window.splitterm.settings.get();
    return {
      theme: s.appearance.theme,
      followOS: s.appearance.followOS,
      reduceMotion: s.appearance.reduceMotion,
      fontSize: s.font.size,
    };
  });

  result.themeApplied = result.themeAttr === 'oled' && /^#0{6}$/i.test(result.bgApp);
  result.motionApplied = result.reduceMotionAttr === 'true';
  result.fontApplied = (result.measuredFontSizes || []).includes('20px');
  result.persistedOk =
    result.persisted.theme === 'OLED Black' &&
    result.persisted.followOS === false &&
    result.persisted.reduceMotion === true &&
    result.persisted.fontSize === 20;

  await finish(0);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  if (win) await win.screenshot({ path: path.resolve('scripts/verify-settings-fail.png') }).catch(() => {});
  await finish(1);
}
