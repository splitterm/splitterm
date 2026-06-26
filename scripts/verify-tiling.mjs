// Runtime verification of the new-terminal + tiling behavior via Playwright's Electron driver.
// Launches the built app (.vite/build/main.js, no fuses so CDP can attach) with an isolated userData
// dir, drives the + button, and reads the real DOM to confirm: launch = empty, 1st + = exactly one
// visible terminal, 2nd + = two, and drag-to-swap reorders the panes. Exits non-zero if any check fails.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron'); // path to electron.exe
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-tiling');
rmSync(userDataDir, { recursive: true, force: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = await electron.launch({ executablePath: electronPath, args: [mainJs, `--user-data-dir=${userDataDir}`] });

const result = { checks: {}, observed: {} };
let win = null;

// A named pass/fail check — the process exits non-zero if any is false.
const check = (name, ok) => {
  result.checks[name] = ok;
};

async function finish() {
  const failed = Object.entries(result.checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  result.failed = failed;
  console.log('RESULT ' + JSON.stringify(result, null, 2));
  await app.close().catch(() => {});
  rmSync(userDataDir, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
}

const paneCount = () => win.locator('[data-leaf-id]').count();
const waitForPanes = async (n, tries = 40) => {
  for (let i = 0; i < tries && (await paneCount()) < n; i++) await sleep(200);
};

try {
  // Find the app window (skip the detached DevTools window).
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
    result.error = 'app window not found';
    check('appWindow', false);
    await finish();
  }

  // 1) Launch state: empty, with the hint visible.
  await win.waitForSelector('text=No terminal open', { timeout: 15000 }).catch(() => {});
  check('launchEmpty', (await paneCount()) === 0);
  check('emptyHintVisible', await win.locator('text=No terminal open').isVisible().catch(() => false));

  const plus = win.getByRole('button', { name: 'New terminal', exact: true });

  // 2) First +: exactly one visible terminal.
  await plus.click();
  await win.locator('[data-leaf-id]').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  check('onePaneAfterFirst', (await paneCount()) === 1);
  check('xtermVisibleAfterFirst', await win.locator('.xterm').first().isVisible().catch(() => false));

  // 3) Second +: two panes. Let the first pane's entry animation settle so the click isn't swallowed.
  await sleep(900);
  await plus.click();
  await waitForPanes(2);
  const twoPanes = (await paneCount()) === 2;
  check('twoPanesAfterSecond', twoPanes);
  await sleep(900); // let the second pane's entry animation settle before grabbing its move handle

  // 4) Responsive drag: a ghost follows the cursor; dropping on the other pane swaps them.
  // Only meaningful with two panes — skip (don't hang on a missing pane) if the split didn't happen.
  const cellTermIds = () => win.locator('[data-leaf-id]').evaluateAll((els) => els.map((e) => e.dataset.termId));
  const ghostBox = () => win.locator('.pane-ghost').boundingBox().catch(() => null);
  const termIdsBefore = await cellTermIds();
  const grip = win.locator('[aria-label="Move pane"]').first();
  const target = win.locator('[data-leaf-id]').nth(1);
  const gb = twoPanes ? await grip.boundingBox().catch(() => null) : null;
  const tb = twoPanes ? await target.boundingBox().catch(() => null) : null;
  if (gb && tb) {
    await win.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
    await win.mouse.down();
    await win.mouse.move(400, 300, { steps: 6 });
    const g1 = await ghostBox();
    await win.mouse.move(700, 520, { steps: 6 });
    const g2 = await ghostBox();
    // Pixel-precise ghost tracking is DPI-sensitive — observe it, don't gate on it.
    result.observed.ghostVisible = !!g1;
    result.observed.ghostTracksCursor =
      !!g1 && !!g2 && Math.abs(g1.x - 414) < 25 && Math.abs(g2.x - 714) < 25 && g2.x - g1.x > 100;

    await win.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 6 });
    await win.mouse.up();
    await sleep(900);
    check('ghostGoneAfterDrop', (await win.locator('.pane-ghost').count()) === 0);
  } else {
    check('dragHandlesPresent', false);
  }
  const termIdsAfter = await cellTermIds();
  result.observed.termIdsBefore = termIdsBefore;
  result.observed.termIdsAfter = termIdsAfter;
  check(
    'swapped',
    termIdsBefore.length === 2 && termIdsBefore[0] === termIdsAfter[1] && termIdsBefore[1] === termIdsAfter[0],
  );

  await finish();
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  if (win) await win.screenshot({ path: path.resolve('scripts/verify-tiling-fail.png') }).catch(() => {});
  check('noException', false);
  await finish();
}
