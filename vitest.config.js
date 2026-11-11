import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'packages/**/*.test.ts', 'scripts/**/*.test.mjs'],
    exclude: ['src/**/*.worker.test.ts'],
  },
  define: {
    __STYLE_HASH__: JSON.stringify('test'),
  },
});
