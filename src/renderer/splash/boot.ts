// The renderer's EARLIEST code — its own tiny entry, loaded ahead of app/main.ts in index.html.
//
// Why a separate entry: ES `import`s all evaluate before a module's body runs, so if the splash were
// kicked off from app/main.ts it could only start AFTER the heavy app graph (xterm, tiling, …) had
// finished loading — leaving the flat themed #splash backdrop on screen for that whole time before
// the logo animation began. Living in its own light module (just the splash + theme bits), this runs
// as soon as its small graph is ready, so the animation starts on ~the first frame and the app bundle
// keeps loading underneath.
import { ipc } from '@platform/ipc-client';
import { resolveThemeAttr } from '@platform/theme-resolve';
import { runSplash } from './splash';

// Theme the document from the synchronously-injected boot snapshot BEFORE first paint, so the splash
// (and the app's first frame) already match the user's theme. settings-controller re-asserts these the
// moment the real settings resolve over IPC. Also lets the splash honour the in-app reduce-motion
// toggle, not just the OS setting.
const boot = ipc.boot ?? { theme: 'Dark', followOS: true, reduceMotion: false };
const themeAttr = resolveThemeAttr(boot, window.matchMedia('(prefers-color-scheme: dark)').matches);
if (themeAttr) document.documentElement.dataset.theme = themeAttr;
if (boot.reduceMotion) document.documentElement.dataset.reduceMotion = 'true';

runSplash();

// The window was created hidden; main waits for this signal to show it, so the FIRST visible frame is
// already themed (no default-dark flash before the theme resolves). Two rAFs so the themed frame is
// composited before show; main also has a failsafe timer if this never fires.
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    try {
      ipc.app.bootReady();
    } catch {
      /* older preload — main's failsafe shows the window */
    }
  }),
);
