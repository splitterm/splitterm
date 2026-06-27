// Runtime verification of cwd-on-split. Launches the built app with an isolated userData dir, opens
// a terminal, makes the shell report a working directory via OSC 7 (file:///C:/Windows), then splits
// the focused pane (Alt+Shift+=) and asserts the NEW pane's shell opened in C:\Windows (its prompt
// shows that path). Exercises OSC 7 parsing → PaneHandle.cwd → split → spawn cwd end-to-end.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-cwd');
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

const anyPaneMatches = async (re) => {
  const rows = win.locator('.xterm-rows');
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const t = await rows.nth(i).innerText().catch(() => '');
    if (re.test(t)) return true;
  }
  return false;
};

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

  await win.getByRole('button', { name: 'New terminal' }).click();
  await sleep(900);
  await win.locator('.xterm-screen').first().click();
  await sleep(150);

  // Make PowerShell emit OSC 7 reporting C:\Windows as the cwd (ESC ]7;file://...BEL).
  await win.keyboard.type('Write-Host -NoNewline "$([char]27)]7;file:///C:/Windows$([char]7)"');
  await win.keyboard.press('Enter');
  await sleep(800); // let xterm parse the OSC 7 and update the pane cwd

  // Split the focused pane to the right (Alt+Shift+=). The new pane should spawn in C:\Windows.
  await win.keyboard.press('Alt+Shift+Equal');
  await sleep(1200);
  result.paneCount = await win.locator('[data-leaf-id]').count();

  // The new pane's prompt shows the cwd with backslashes ("PS C:\Windows>"); the typed command in the
  // first pane used forward slashes ("file:///C:/Windows"), so a backslash match identifies the split.
  let opened = false;
  for (let i = 0; i < 25; i++) {
    if (await anyPaneMatches(/C:\\Windows/)) {
      opened = true;
      break;
    }
    await sleep(300);
  }
  result.newPaneInCwd = opened;

  const ok = result.paneCount === 2 && result.newPaneInCwd;
  await finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  if (win) await win.screenshot({ path: path.resolve('scripts/verify-cwd-split-fail.png') }).catch(() => {});
  await finish(1);
}
