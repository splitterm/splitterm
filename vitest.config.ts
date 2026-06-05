import { defineConfig } from 'vitest/config';

// Unit tests for pure logic (shared/domain, etc.). Electron/DOM-free by default.
// Co-locate tests as *.test.ts next to the code they cover.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
