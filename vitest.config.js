import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.js'],
    exclude: ['src/**/*.worker.test.js'],
  },
  define: {
    __STYLE_HASH__: JSON.stringify('test'),
  },
});
