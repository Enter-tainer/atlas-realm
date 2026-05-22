import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.js'],
  },
  define: {
    __STYLE_HASH__: JSON.stringify('test'),
  },
});
