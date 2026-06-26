// Runs every scripts/verify-*.mjs against the built app and propagates a non-zero exit if any fails.
// The verify scripts launch .vite/build/main.js via Playwright's Electron driver, so the app must be
// built first: `npm run package`. Auto-discovers scripts so new verify-*.mjs are picked up for free.
import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const mainJs = path.resolve(scriptsDir, '..', '.vite', 'build', 'main.js');

if (!existsSync(mainJs)) {
  console.error(`e2e: ${path.relative(process.cwd(), mainJs)} not found — run \`npm run package\` first.`);
  process.exit(1);
}

const scripts = readdirSync(scriptsDir)
  .filter((f) => /^verify-.*\.mjs$/.test(f))
  .sort();

if (scripts.length === 0) {
  console.error('e2e: no scripts/verify-*.mjs found');
  process.exit(1);
}

const failures = [];
for (const script of scripts) {
  console.log(`\n=== e2e: ${script} ===`);
  const { status } = spawnSync(process.execPath, [path.join(scriptsDir, script)], { stdio: 'inherit' });
  const code = status ?? 1;
  console.log(`=== ${script} exited ${code} ===`);
  if (code !== 0) failures.push(script);
}

if (failures.length) {
  console.error(`\ne2e: ${failures.length}/${scripts.length} failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log(`\ne2e: all ${scripts.length} verify script(s) passed`);
