// Runtime verification of terminal copy/paste + the right-click context menu. Launches the built
// app with an isolated userData dir, prints a marker, then: (copy) right-click → Select all →
// Ctrl+Shift+C and asserts the OS clipboard got the marker; (paste) seeds the OS clipboard and
// Ctrl+Shift+V and asserts the text lands at the prompt. Drives the real Electron clipboard via the
// main process, so it exercises the whole preload→main IPC bridge. Restores the clipboard at the end.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-clipboard');
rmSync(userDataDir, { recursive: true, force: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = await electron.launch({ executablePath: electronPath, args: [mainJs, `--user-data-dir=${userDataDir}`] });

const result = {};
let win = null;
let originalClipboard = '';

async function finish(code) {
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), originalClipboard).catch(() => {});
  console.log('RESULT ' + JSON.stringify(result, null, 2));
  await app.close().catch(() => {});
  rmSync(userDataDir, { recursive: true, force: true });
  process.exit(code);
}

const COPY_MARKER = 'splitterm-copy-marker';
const PASTE_TEXT = 'splitterm-paste-payload';

try {
  originalClipboard = await app.evaluate(({ clipboard }) => clipboard.readText()).catch(() => '');

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

  // Open a terminal and print the copy marker.
  await win.getByRole('button', { name: 'New terminal' }).click();
  await sleep(800);
  result.paneCount = await win.locator('[data-leaf-id]').count();
  await win.locator('.xterm-screen').first().click();
  await sleep(150);
  await win.keyboard.type(`echo ${COPY_MARKER}`);
  await win.keyboard.press('Enter');
  for (let i = 0; i < 30; i++) {
    const txt = await win.locator('.xterm-rows').first().innerText().catch(() => '');
    if ((txt.match(new RegExp(COPY_MARKER, 'g')) || []).length >= 2) break;
    await sleep(200);
  }

  // ---- COPY via context menu (Select all) + Ctrl+Shift+C ----
  await app.evaluate(({ clipboard }) => clipboard.writeText('')); // clear so we measure our copy
  await win.locator('.xterm-screen').first().click({ button: 'right' });
  await sleep(300);
  result.contextMenuVisible = await win.locator('.term-context-menu').first().isVisible().catch(() => false);
  result.menuItems = await win
    .locator('.term-context-menu button')
    .evaluateAll((bs) => bs.map((b) => b.textContent?.trim()))
    .catch(() => []);
  await win.locator('.term-context-menu').getByText('Select all').click();
  await sleep(200);
  // Focus the xterm textarea without clicking (a click would clear the selection), then copy.
  await win.evaluate(() => document.querySelector('.xterm-helper-textarea')?.focus());
  await sleep(100);
  await win.keyboard.press('Control+Shift+C');
  await sleep(300);
  const clipAfterCopy = await app.evaluate(({ clipboard }) => clipboard.readText());
  result.copiedMarker = clipAfterCopy.includes(COPY_MARKER);

  // ---- PASTE via Ctrl+Shift+V ----
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), PASTE_TEXT);
  await win.locator('.xterm-screen').first().click(); // focus (and clear selection)
  await sleep(150);
  await win.keyboard.press('Control+Shift+V');
  let buf = '';
  for (let i = 0; i < 30; i++) {
    buf = await win.locator('.xterm-rows').first().innerText().catch(() => '');
    if (buf.includes(PASTE_TEXT)) break;
    await sleep(200);
  }
  result.pasted = buf.includes(PASTE_TEXT);

  const ok = result.contextMenuVisible && result.copiedMarker && result.pasted;
  await finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  if (win) await win.screenshot({ path: path.resolve('scripts/verify-clipboard-fail.png') }).catch(() => {});
  await finish(1);
}
