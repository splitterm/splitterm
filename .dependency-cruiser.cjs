// The import firewall (see plans/project-structure.md §9).
// M1 ships the ~5 critical "no cross-process leak" rules — 80% of the anti-cable-salad
// value for 20% of the setup. Layer/feature rules + project references come at M2+.
//
// Run with:  npm run dep:check   (depcruise src)

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'Import cycles are cable salad by definition.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'shared-is-a-leaf',
      comment: 'shared/ is the spine: it may import nothing from the app rings.',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: { path: '^src/(main|pty-host|preload|renderer)/' },
    },
    {
      name: 'shared-stays-pure',
      comment: 'shared/ must not pull in electron or native modules.',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: { dependencyTypes: ['npm'], path: '^(electron|node-pty)(/|$)' },
    },
    {
      name: 'no-cross-process',
      comment: 'Processes communicate only via the typed contracts in shared/ipc.',
      severity: 'error',
      from: { path: '^src/(main|pty-host|preload|renderer)/' },
      to: { path: '^src/(main|pty-host|preload|renderer)/', pathNot: '^src/$1/' },
    },
    {
      name: 'renderer-no-node',
      comment: 'The renderer is sandboxed: no electron, no native, no node builtins.',
      severity: 'error',
      from: { path: '^src/renderer/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'renderer-no-electron-or-pty',
      comment: 'The renderer reaches the OS only through window.splitterm (preload).',
      severity: 'error',
      from: { path: '^src/renderer/' },
      to: { dependencyTypes: ['npm'], path: '^(electron|node-pty)(/|$)' },
    },
    {
      name: 'node-pty-only-in-pty-host',
      comment: 'All node-pty usage lives in the pty-host process.',
      severity: 'error',
      from: { pathNot: '^src/pty-host/' },
      to: { dependencyTypes: ['npm'], path: '^node-pty(/|$)' },
    },
    {
      name: 'electron-only-in-main-and-preload',
      comment: 'electron APIs belong to main + preload; not renderer or pty-host.',
      severity: 'error',
      from: { pathNot: '^src/(main|preload)/' },
      to: { dependencyTypes: ['npm'], path: '^electron(/|$)' },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    // See type-only imports too, so a cross-process `import type` is still caught.
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(\\.css|\\.test\\.ts)$' },
  },
};
