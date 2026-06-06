// Runtime verification of the new-terminal behavior via Playwright's Electron driver.
// Launches the built app (.vite/build/main.js, no fuses so CDP can attach), drives the + button,
// and reads the real DOM to confirm: launch = empty, 1st + = exactly one VISIBLE terminal, 2nd + = two.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electronPath = require('electron'); // path to electron.exe
const mainJs = path.resolve('.vite/build/main.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const app = await electron.launch({ executablePath: electronPath, args: [mainJs] });

// Find the app window (skip the detached DevTools window).
let win = null;
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
  console.log('RESULT ' + JSON.stringify({ error: 'app window not found' }));
  await app.close();
  process.exit(1);
}

const paneCount = () => win.locator('[data-leaf-id]').count();
const firstPaneBox = async () => {
  const loc = win.locator('[data-leaf-id]').first();
  return (await loc.count()) ? loc.boundingBox() : null;
};

const result = { steps: [] };

// 1) Launch state
await win.waitForSelector('text=No terminal open', { timeout: 15000 }).catch(() => {});
result.launchPanes = await paneCount();
result.emptyHintVisible = await win.locator('text=No terminal open').isVisible().catch(() => false);

const plus = win.getByRole('button', { name: 'New terminal', exact: true });

// 2) First +
await plus.click();
await win.locator('[data-leaf-id]').first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
await sleep(900);
result.afterFirst = await paneCount();
result.firstPaneBox = await firstPaneBox();
result.xtermAfterFirst = await win.locator('.xterm').count();
result.xtermVisibleAfterFirst = await win.locator('.xterm').first().isVisible().catch(() => false);

// 3) Second +
await plus.click();
await sleep(900);
result.afterSecond = await paneCount();
result.xtermAfterSecond = await win.locator('.xterm').count();

console.log('RESULT ' + JSON.stringify(result, null, 2));
await app.close();
