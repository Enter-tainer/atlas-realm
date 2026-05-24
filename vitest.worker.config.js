import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/worker.ts',
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
  test: {
    include: ['src/**/*.worker.test.ts'],
    isolate: true,
  },
  define: {
    __STYLE_HASH__: JSON.stringify('test'),
  },
});
