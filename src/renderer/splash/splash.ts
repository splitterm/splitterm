// The startup splash: a one-shot "boot" animation on a black stage. It draws the splitterm mark
// pane-by-pane, lights the active pane, blinks the cursor, types the wordmark, then dissolves into
// the app. It plays while the renderer wires everything up underneath, so the black moment doubles
// as cover for first paint.
//
// The opaque black <div id="splash"> already lives in index.html, so it paints on the very first
// frame (no flash of unstyled chrome). This module fills it with the animated lockup, runs the
// choreography on the Web Animations API, and on completion removes the overlay and tells main to
// reveal the native window controls — hidden into the black canvas during the boot for a clean
// stage (see main.ts). The whole sequence is skippable (click / any key) and self-heals via a
// safety timeout if an animation never settles.
//
// Mark geometry mirrors assets/splitterm-logos/mono.svg.
import './splash.css';
import { ipc } from '@platform/ipc-client';

const WORD = 'splitterm';

// Easings: soft ease-outs for the draws, a decisive ease-in for the dissolve.
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const EASE_OUT_SOFT = 'cubic-bezier(0.05, 0.7, 0.1, 1)';
const EASE_IN = 'cubic-bezier(0.6, 0, 0.9, 0.2)';

// End of the reveal animation on the master timeline — the safety timeout is anchored to it.
const REVEAL_END_MS = 2680;

/** Build the lockup DOM inside #splash and return the elements the choreography animates. */
function build(root: HTMLElement): {
  stage: HTMLElement;
  left: SVGElement;
  tr: SVGElement;
  trfill: SVGElement;
  br: SVGElement;
  cursor: SVGElement;
  chars: HTMLElement[];
} {
  // SVG inside an HTML container is namespaced correctly by the HTML parser (foreign content).
  root.innerHTML = `
    <div class="splash-stage">
      <svg class="splash-mark" viewBox="0 0 256 256" fill="none" aria-hidden="true">
        <rect class="pane pane-draw" data-el="left"   x="28"  y="28"  width="100" height="200" rx="12" pathLength="100"/>
        <rect class="pane pane-draw" data-el="tr"     x="146" y="28"  width="82"  height="91"  rx="12" pathLength="100"/>
        <rect class="fill"           data-el="trfill" x="146" y="28"  width="82"  height="91"  rx="12"/>
        <rect class="pane pane-draw" data-el="br"     x="146" y="137" width="82"  height="91"  rx="12" pathLength="100"/>
        <rect class="cursor"         data-el="cursor" x="50"  y="56"  width="28"  height="34"  rx="3"/>
      </svg>
      <div class="splash-word" data-el="word"></div>
    </div>`;

  const pick = <T extends Element>(sel: string): T => root.querySelector(sel) as T;
  const word = pick<HTMLElement>('[data-el="word"]');
  const chars = [...WORD].map((c) => {
    const span = document.createElement('span');
    span.className = 'ch';
    span.textContent = c;
    word.appendChild(span);
    return span;
  });

  return {
    stage: pick('.splash-stage'),
    left: pick('[data-el="left"]'),
    tr: pick('[data-el="tr"]'),
    trfill: pick('[data-el="trfill"]'),
    br: pick('[data-el="br"]'),
    cursor: pick('[data-el="cursor"]'),
    chars,
  };
}

/** Choreograph the full intro + dissolve; returns every Animation so callers can await/cancel them. */
function choreograph(root: HTMLElement, el: ReturnType<typeof build>): Animation[] {
  const anims: Animation[] = [];
  const add = (
    node: Element,
    frames: Keyframe[],
    opts: KeyframeAnimationOptions,
  ): Animation => {
    const a = node.animate(frames, { fill: 'both', ...opts });
    anims.push(a);
    return a;
  };

  // 1. left pane draws itself
  add(el.left, [{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], {
    duration: 560,
    delay: 140,
    easing: EASE_OUT_SOFT,
  });

  // 2. top-right outline draws
  add(el.tr, [{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], {
    duration: 300,
    delay: 480,
    easing: EASE_OUT_SOFT,
  });

  // 3. top-right pane "lights up" — fill wipes down
  add(el.trfill, [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)' }], {
    duration: 300,
    delay: 740,
    easing: EASE_OUT,
  });

  // 4. bottom-right outline draws
  add(el.br, [{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], {
    duration: 320,
    delay: 620,
    easing: EASE_OUT_SOFT,
  });

  // 5. cursor block pops in
  add(el.cursor, [
    { opacity: 0, transform: 'scale(0.4)' },
    { opacity: 1, transform: 'scale(1.12)', offset: 0.7 },
    { opacity: 1, transform: 'scale(1)' },
  ], { duration: 260, delay: 760, easing: EASE_OUT });

  // 6. cursor blinks, then settles solid (fill:forwards so it can't paint before the pop above)
  add(el.cursor, [
    { opacity: 1, offset: 0 }, { opacity: 1, offset: 0.18 },
    { opacity: 0.12, offset: 0.32 }, { opacity: 0.12, offset: 0.5 },
    { opacity: 1, offset: 0.64 }, { opacity: 1, offset: 0.82 },
    { opacity: 0.12, offset: 0.9 }, { opacity: 1, offset: 1 },
  ], { duration: 1000, delay: 1040, easing: 'steps(1)', fill: 'forwards' });

  // 7. wordmark letters rise + fade in, left to right
  el.chars.forEach((c, i) => {
    add(c, [
      { opacity: 0, transform: 'translateY(0.42em)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 360, delay: 940 + i * 52, easing: EASE_OUT });
  });

  // 8. REVEAL — the lockup eases up while the stage itself dissolves into the app behind it
  add(el.stage, [
    { opacity: 1, transform: 'scale(1)' },
    { opacity: 1, transform: 'scale(1.012)', offset: 0.5 },
    { opacity: 0, transform: 'scale(1.06)' },
  ], { duration: 520, delay: REVEAL_END_MS - 560, easing: EASE_IN });
  add(root, [
    { opacity: 1, offset: 0 },
    { opacity: 1, offset: 0.45 },
    { opacity: 0, offset: 1 },
  ], { duration: 560, delay: REVEAL_END_MS - 560, easing: EASE_IN });

  return anims;
}

/** Reduced-motion path: no drawing — show the finished lockup, then dissolve the black into the app. */
function choreographReduced(root: HTMLElement, el: ReturnType<typeof build>): Animation[] {
  // Finish the outlines via INLINE style (not the presentation attribute) so they outrank the
  // `.pane-draw { stroke-dashoffset: 100 }` class rule — otherwise the panes stay dashed away.
  el.left.style.strokeDashoffset = '0';
  el.tr.style.strokeDashoffset = '0';
  el.br.style.strokeDashoffset = '0';
  (el.trfill as SVGElement).style.clipPath = 'inset(0 0 0 0)';
  (el.cursor as SVGElement).style.opacity = '1';
  el.chars.forEach((c) => {
    c.style.opacity = '1';
    c.style.transform = 'none';
  });
  return [
    el.stage.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, easing: EASE_OUT, fill: 'both' }),
    root.animate([{ opacity: 1 }, { opacity: 1 }, { opacity: 0 }], {
      duration: 1400,
      easing: EASE_IN,
      fill: 'forwards',
    }),
  ];
}

/**
 * Play the boot splash once, then tear it down. Safe to call exactly once at renderer startup;
 * a no-op if the #splash overlay isn't present. Never throws.
 */
export function runSplash(): void {
  const root = document.getElementById('splash');
  if (!root) return;

  const reduced =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.dataset.reduceMotion === 'true';

  const el = build(root);
  const anims = reduced ? choreographReduced(root, el) : choreograph(root, el);

  let done = false;
  const ac = new AbortController(); // tears the skip listeners down on any exit (no leak)
  const finish = (): void => {
    if (done) return;
    done = true;
    ac.abort();
    root.remove();
    // Bring the native window controls back now that the black canvas is gone.
    try {
      ipc.app.splashDone();
    } catch {
      /* non-fatal: chrome also self-reveals via main's failsafe timer */
    }
  };

  // Normal end: the dissolve animation resolves.
  Promise.all(anims.map((a) => a.finished))
    .then(finish)
    .catch(() => {
      /* a cancelled animation rejects .finished — finish() may have already run */
    });

  // Skip: first click or key dismisses with a quick fade. Freeze the current frame (don't cancel —
  // that would snap a half-revealed dissolve back to opaque black) and fade out from where it is.
  const skip = (): void => {
    if (done) return;
    ac.abort(); // no second skip
    for (const a of anims) a.pause();
    const from = Number.parseFloat(getComputedStyle(root).opacity) || 1;
    root
      .animate([{ opacity: from }, { opacity: 0 }], { duration: 200, easing: EASE_IN, fill: 'forwards' })
      .finished.then(finish, finish);
  };
  root.addEventListener('pointerdown', skip, { signal: ac.signal });
  window.addEventListener('keydown', skip, { signal: ac.signal });

  // Safety net: never leave the overlay (or hidden window controls) stuck if something stalls.
  window.setTimeout(finish, REVEAL_END_MS + 1500);
}
