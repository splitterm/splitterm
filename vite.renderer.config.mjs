import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import tailwindcss from '@tailwindcss/vite';

// Renderer (Chromium 148). Single renderer hosting all terminals.
// A UI-framework plugin (e.g. vite-plugin-solid) gets added here once the framework is chosen.
// https://vitejs.dev/config
export default defineConfig({
  plugins: [tsconfigPaths(), tailwindcss()],
  build: { target: 'chrome148' },
});
