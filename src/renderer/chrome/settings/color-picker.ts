// A small self-contained colour picker: a saturation/value square + a hue slider + a hex field + a
// strip of vibrant presets. Emits a #rrggbb on every change. No dependencies; pointer-driven.

export interface ColorPicker {
  el: HTMLElement;
  /** set the displayed colour from a #hex (e.g. when the field/presets change it) */
  setHex(hex: string): void;
}

interface HSV {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..1
}

function hsvToHex({ h, s, v }: HSV): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (n: number): string =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function hexToHsv(hex: string): HSV | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1] ?? '', 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = (((g - b) / d) % 6 + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: max ? d / max : 0, v: max };
}

const PRESETS = ['#3fb950', '#d29922', '#e0843b', '#f85149', '#d97757', '#4493f8', '#a371f7', '#ffffff'];

// Drag a pointer over `area`, calling `onMove(fracX, fracY)` with 0..1 coordinates (clamped).
function trackPointer(area: HTMLElement, onMove: (fx: number, fy: number) => void): void {
  const handle = (e: PointerEvent): void => {
    const r = area.getBoundingClientRect();
    onMove(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
  };
  area.addEventListener('pointerdown', (e) => {
    area.setPointerCapture(e.pointerId);
    handle(e);
    const move = (ev: PointerEvent): void => handle(ev);
    const up = (ev: PointerEvent): void => {
      try {
        area.releasePointerCapture(ev.pointerId);
      } catch {
        /* already released (e.g. on pointercancel) */
      }
      area.removeEventListener('pointermove', move);
      area.removeEventListener('pointerup', up);
      area.removeEventListener('pointercancel', up); // gesture takeover fires cancel, not up — clean up too
    };
    area.addEventListener('pointermove', move);
    area.addEventListener('pointerup', up);
    area.addEventListener('pointercancel', up);
  });
}

export function createColorPicker(initial: string, onChange: (hex: string) => void): ColorPicker {
  let hsv: HSV = hexToHsv(initial) ?? { h: 210, s: 0.7, v: 0.95 };

  const el = document.createElement('div');
  el.className = 'flex flex-col gap-2 w-[200px]';

  // Saturation/value square.
  const sv = document.createElement('div');
  sv.className = 'relative h-[120px] rounded-[var(--r-sm)] cursor-crosshair touch-none';
  const svThumb = document.createElement('div');
  svThumb.className = 'absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border-2 border-white pointer-events-none';
  svThumb.style.boxShadow = '0 0 0 1px rgba(0,0,0,.5)';
  sv.append(svThumb);

  // Hue slider.
  const hue = document.createElement('div');
  hue.className = 'relative h-3 rounded-full cursor-pointer touch-none';
  hue.style.background = 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)';
  const hueThumb = document.createElement('div');
  hueThumb.className = 'absolute top-1/2 w-3 h-3 -ml-1.5 -mt-1.5 rounded-full bg-white border border-[rgba(0,0,0,.4)] pointer-events-none';
  hue.append(hueThumb);

  // Hex field + preset strip.
  const hexInput = document.createElement('input');
  hexInput.type = 'text';
  hexInput.spellcheck = false;
  hexInput.setAttribute('aria-label', 'Hex colour');
  hexInput.className =
    'h-7 px-2 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-input)] text-[12px] ' +
    'font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)]';

  const presets = document.createElement('div');
  presets.className = 'flex gap-1';
  for (const p of PRESETS) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.title = p;
    sw.className = 'w-5 h-5 rounded-[var(--r-sm)] border border-[var(--border)] cursor-pointer';
    sw.style.background = p;
    sw.addEventListener('click', () => apply(hexToHsv(p)!, true));
    presets.append(sw);
  }

  el.append(sv, hue, hexInput, presets);

  function paint(): void {
    const hueHex = hsvToHex({ h: hsv.h, s: 1, v: 1 });
    sv.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), ${hueHex}`;
    svThumb.style.left = `${hsv.s * 100}%`;
    svThumb.style.top = `${(1 - hsv.v) * 100}%`;
    hueThumb.style.left = `${(hsv.h / 360) * 100}%`;
    const hex = hsvToHex(hsv);
    if (document.activeElement !== hexInput) hexInput.value = hex;
  }
  function apply(next: HSV, emit: boolean): void {
    hsv = next;
    paint();
    if (emit) onChange(hsvToHex(hsv));
  }

  trackPointer(sv, (fx, fy) => apply({ ...hsv, s: fx, v: 1 - fy }, true));
  trackPointer(hue, (fx) => apply({ ...hsv, h: fx * 360 }, true));
  hexInput.addEventListener('input', () => {
    const parsed = hexToHsv(hexInput.value);
    if (parsed) apply(parsed, true);
  });

  paint();
  return {
    el,
    setHex(hex: string): void {
      const parsed = hexToHsv(hex);
      if (parsed) {
        hsv = parsed;
        paint();
      }
    },
  };
}
