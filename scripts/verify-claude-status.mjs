// Runtime verification of the Claude-working sidebar status (v3, animation-gated). Three things:
//  (A) ECHO GATE: typing into a pane must NOT show a working indicator.
//  (B) DETECTION: an ANIMATING "esc to interrupt" footer at the screen bottom (Claude's actual layout)
//      lights claudeWorking. We simulate it with a plain shell by filling the screen, then repeatedly
//      printing the affordance with a CHANGING counter (the line keeps changing = animating).
//  (C) A STATIC "esc to interrupt" line must NOT light it (the cat'd-file / hung-Claude false positive).
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainJs = path.resolve('.vite/build/main.js');
const userDataDir = path.join(os.tmpdir(), 'splitterm-e2e-claude-status');
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
const statusOf = () => win.evaluate(() => document.querySelector('.pane-status-dot')?.getAttribute('data-status') ?? '');
const waitStatus = async (want, tries) => {
  for (let i = 0; i < tries; i++) {
    if ((await statusOf()) === want) return true;
    await sleep(200);
  }
  return false;
};

try {
  for (let i = 0; i < 30 && !win; i++) {
    for (const w of app.windows()) if (await w.locator('#app').count().catch(() => 0)) { win = w; break; }
    if (!win) await sleep(300);
  }
  if (!win) { result.error = 'no window'; await finish(1); }

  await win.getByRole('button', { name: 'Toggle sidebar' }).click();
  await sleep(300);
  await win.getByRole('button', { name: 'New terminal' }).click();
  await sleep(2400);
  result.statusInitial = await statusOf();

  // (A) ECHO GATE: typing never flips to working/claudeWorking.
  await win.locator('.xterm-screen').first().click();
  await sleep(150);
  let typingShowedProgress = false;
  for (const ch of 'echo typing-no-progress'.split('')) {
    await win.keyboard.type(ch);
    await sleep(70);
    const st = await statusOf();
    if (st === 'working' || st === 'claudeWorking') typingShowedProgress = true;
  }
  result.typingStayedCalm = !typingShowedProgress;
  await win.keyboard.press('Enter');
  await sleep(1500);

  // (C) STATIC affordance must NOT light claudeWorking (fill screen, print one static line, hold).
  await win.keyboard.type('1..50 | % { Write-Host "" }; Write-Host "static (esc to interrupt) line"');
  await win.keyboard.press('Enter');
  await sleep(3000); // longer than the confirm window — must stay non-claudeWorking
  result.staticDidNotLight = (await statusOf()) !== 'claudeWorking';

  // (B) ANIMATING affordance at the bottom → claudeWorking.
  await win.keyboard.type('1..40 | % { Write-Host "" }; 1..18 | % { Write-Host "Forging... ($_ tokens, esc to interrupt)"; Start-Sleep -Milliseconds 220 }');
  await win.keyboard.press('Enter');
  result.claudeDetected = await waitStatus('claudeWorking', 30); // during the animating loop

  // Scroll the affordance well off the bottom → no longer present → reverts (out of claudeWorking).
  await win.keyboard.type("1..80 | % { '.' }");
  await win.keyboard.press('Enter');
  result.cleared = await waitStatus('idle', 30); // up to 6s for the GRACE exit
  result.clearedStatus = await statusOf();

  const ok =
    result.statusInitial !== 'claudeWorking' &&
    result.typingStayedCalm &&
    result.staticDidNotLight &&
    result.claudeDetected &&
    result.cleared;
  result.ok = ok;
  await finish(ok ? 0 : 1);
} catch (err) {
  result.error = String(err && err.message ? err.message : err);
  await finish(1);
}
