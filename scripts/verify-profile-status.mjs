// Runtime verification of per-profile status appearance. Seed a default profile with a status override
// (magenta 'working', static), open a pane with it, drive it to 'working', and assert the sidebar dot
// takes the profile's colour and is NOT pulsing. Then flip the profile to status-off and assert the
// dot hides live (settings change → sidebar.refresh()).
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-profile-status');
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
const firstDot = () => win.locator('.pane-status-dot').first();

try {
  for (let i = 0; i < 30 && !win; i++) {
    for (const w of app.windows()) if (await w.locator('#app').count().catch(() => 0)) { win = w; break; }
    if (!win) await sleep(300);
  }
  if (!win) { result.error = 'no window'; await finish(1); }

  // Seed a default profile carrying a per-profile status override.
  const shellId = await win.evaluate(async () => (await window.splitterm.pty.profiles())[0]?.id ?? '');
  result.shellId = shellId;
  await win.evaluate(async (sid) => {
    await window.splitterm.settings.set({
      profiles: [{ id: 'vivid', name: 'Vivid', baseShellId: sid, status: { colors: { working: '#ff00ff' }, animations: { working: 'static' } } }],
      defaultProfileId: 'vivid',
    });
  }, shellId);
  await sleep(400);

  await win.getByRole('button', { name: 'Toggle sidebar' }).click();
  await sleep(200);
  await win.getByRole('button', { name: 'New terminal' }).click(); // opens the default → the Vivid profile
  await sleep(1300);

  // Drive sustained output so the pane reports 'working'.
  await win.locator('.xterm-screen').first().click();
  await win.keyboard.type('1..50 | % { $_; Start-Sleep -Milliseconds 70 }');
  await win.keyboard.press('Enter');

  for (let i = 0; i < 50; i++) {
    if ((await firstDot().getAttribute('data-status').catch(() => null)) === 'working') break;
    await sleep(120);
  }
  result.dotStatus = await firstDot().getAttribute('data-status');
  result.dotColor = await firstDot().evaluate((el) => getComputedStyle(el).backgroundColor);
  result.dotPulsing = await firstDot().evaluate((el) => el.classList.contains('pulse'));

  // Flip the profile to status-off → the dot must hide live.
  await win.evaluate(async (sid) => {
    await window.splitterm.settings.set({ profiles: [{ id: 'vivid', name: 'Vivid', baseShellId: sid, status: { enabled: false } }] });
  }, shellId);
  await sleep(500);
  result.dotHiddenAfterDisable = await firstDot().evaluate((el) => getComputedStyle(el).display === 'none');

  const magenta = (result.dotColor || '').replace(/\s/g, '') === 'rgb(255,0,255)';
  const ok = result.dotStatus === 'working' && magenta && result.dotPulsing === false && result.dotHiddenAfterDisable === true;
  result.ok = ok;
  await finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  await finish(1);
}
