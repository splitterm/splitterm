// A left drawer overlay for settings & navigation. Empty for now.
// Animation is compositor-only: the drawer slides via `transform` and the backdrop fades via
// `opacity` — it overlays the body (does NOT resize/reflow the terminal). See ui-design.md §8.

export interface Sidebar {
  /** backdrop + drawer; mount inside the body element */
  element: HTMLElement;
  toggle(): void;
  open(): void;
  close(): void;
  isOpen(): boolean;
}

const MOTION =
  'transition-[transform,opacity] ease-[var(--ease-out)] duration-[var(--motion-base)] motion-reduce:transition-none';

export function createSidebar(): Sidebar {
  const wrap = document.createElement('div');
  wrap.className = 'contents';

  const backdrop = document.createElement('div');
  backdrop.className = `absolute inset-0 z-10 bg-black/40 opacity-0 pointer-events-none ${MOTION}`;

  const drawer = document.createElement('aside');
  drawer.className =
    `absolute inset-y-0 left-0 z-20 w-[260px] -translate-x-full flex flex-col ` +
    `bg-[var(--bg-surface)] border-r border-[var(--border)] ${MOTION}`;
  drawer.innerHTML = `
    <div class="h-9 flex items-center px-3 shrink-0 border-b border-[var(--border)]
                text-[11px] font-semibold tracking-wide uppercase text-[var(--text-secondary)] select-none">
      Menu
    </div>
    <div class="flex-1 flex items-center justify-center text-[11px] text-[var(--text-disabled)] select-none">
      Nothing here yet
    </div>
  `;

  wrap.append(backdrop, drawer);

  let open = false;
  const render = (): void => {
    drawer.classList.toggle('-translate-x-full', !open);
    drawer.classList.toggle('translate-x-0', open);
    backdrop.classList.toggle('opacity-0', !open);
    backdrop.classList.toggle('pointer-events-none', !open);
    backdrop.classList.toggle('opacity-100', open);
  };

  backdrop.addEventListener('click', () => {
    open = false;
    render();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) {
      open = false;
      render();
    }
  });

  return {
    element: wrap,
    toggle() {
      open = !open;
      render();
    },
    open() {
      open = true;
      render();
    },
    close() {
      open = false;
      render();
    },
    isOpen() {
      return open;
    },
  };
}
