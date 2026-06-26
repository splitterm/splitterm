const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    // The Vite plugin otherwise sets `ignore` to drop everything except `/.vite`, which
    // excludes node_modules — so the externalized native module (node-pty) never ships.
    // Provide our own ignore that keeps the Vite output AND the node-pty subtree.
    // (electron-squirrel-startup + @xterm/* are bundled by Vite, so they don't need copying.)
    ignore: (file) => {
      if (!file) return false;
      if (file.startsWith('/.vite')) return false;
      if (file === '/node_modules') return false;
      if (file === '/node_modules/node-pty' || file.startsWith('/node_modules/node-pty/')) return false;
      return true;
    },
  },
  // node-pty ships ABI-stable N-API prebuilds, so no native rebuild is needed (and this avoids
  // requiring a C++ build toolchain). Rebuild nothing.
  rebuildConfig: { onlyModules: [] },
  // No Linux makers (deb/rpm): node-pty ships no Linux prebuild and native rebuild is disabled above,
  // so a Linux package would install an app that can't spawn any shell. Re-add once Linux PTY support
  // lands (a prebuild or an enabled rebuild).
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
  ],
  plugins: [
    // Unpacks native *.node addons (e.g. node-pty) from app.asar so dlopen can load them.
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    {
      name: '@electron-forge/plugin-vite',
      config: {
        // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
        // If you are familiar with Vite configuration, it will look really familiar.
        build: [
          {
            // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
            entry: 'src/main/main.ts',
            config: 'vite.main.config.mjs',
            target: 'main',
          },
          {
            entry: 'src/preload/preload.ts',
            config: 'vite.preload.config.mjs',
            target: 'preload',
          },
          {
            // PTY-host utilityProcess: a Node child of main hosting all node-pty shells.
            entry: 'src/pty-host/host.ts',
            config: 'vite.pty-host.config.mjs',
            target: 'main',
          },
        ],
        renderer: [
          {
            name: 'main_window',
            config: 'vite.renderer.config.mjs',
          },
        ],
      },
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
