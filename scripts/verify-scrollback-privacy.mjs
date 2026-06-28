// Pins the privacy gate: with "Restore terminal history" OFF (the default), terminal OUTPUT must NOT
// be written to session.json. Open a terminal, echo a unique marker, close, then read session.json
// and assert the marker (and any `scrollback` field) is absent. The companion verify-scrollback-
// restore.mjs covers the ON path.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync, mkdirSync, readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-scrollback-privacy');
rmSync(userDataDir, { recursive: true, force: true });
mkdirSync(userDataDir, { recursive: true });

const MARK = 'PRIVACY_MARK_88';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const result = {};
const app = await electron.launch({ executablePath: electronPath, args: [mainJs, `--user-data-dir=${userDataDir}`] });

async function finish(code) {
  console.log('RESULT ' + JSON.stringify(result, null, 2));
  await app.close().catch(() => {});
  rmSync(userDataDir, { recursive: true, force: true });
  process.exit(code);
}

let win = null;
try {
  for (let i = 0; i < 30 && !win; i++) {
    for (const w of app.windows()) if (await w.locator('#app').count().catch(() => 0)) { win = w; break; }
    if (!win) await sleep(300);
  }
  if (!win) { result.error = 'no window'; await finish(1); }

  // restoreScrollback defaults OFF — open a terminal and produce a unique line.
  await win.getByRole('button', { name: 'New terminal' }).click();
  await sleep(1000);
  await win.locator('.xterm-screen').first().click();
  await sleep(150);
  await win.keyboard.type(`echo ${MARK}`);
  await win.keyboard.press('Enter');
  for (let i = 0; i < 30; i++) {
    const t = await win.evaluate(() => [...document.querySelectorAll('.xterm-rows')].map((r) => r.innerText).join('\n'));
    if (new RegExp(MARK).test(t)) break;
    await sleep(300);
  }
  await sleep(1200);
  await app.close().catch(() => {}); // session saves (layout) on quit, but WITHOUT scrollback

  await sleep(400);
  const raw = readFileSync(path.join(userDataDir, 'session.json'), 'utf8');
  const session = JSON.parse(raw);
  result.sessionSaved = !!session.root; // the layout WAS persisted (restoreSession is on by default)
  result.markerAbsent = !raw.includes(MARK); // ...but the terminal output was NOT
  result.noScrollbackKey = Object.values(session.leaves ?? {}).every((l) => l && l.scrollback === undefined);

  const ok = result.sessionSaved && result.markerAbsent && result.noScrollbackKey;
  result.ok = ok;
  await finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  await finish(1);
}
