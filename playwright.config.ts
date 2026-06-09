import { defineConfig, devices } from '@playwright/test';

const env =
  (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env || {};
const port = Number(env.PLAYWRIGHT_PORT || 4178);
const baseURL = env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;
const isCi = Boolean(env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: isCi ? 2 : 0,
  workers: isCi ? 2 : undefined,
  reporter: isCi ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    locale: 'en-US',
    colorScheme: 'light',
    contextOptions: {
      reducedMotion: 'reduce',
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /.*\.mobile\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      testMatch: /.*\.mobile\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `pnpm exec wrangler d1 migrations apply orm_accounts --local --preview false && pnpm exec vite --host 127.0.0.1 --port ${port}`,
        url: baseURL,
        reuseExistingServer: !isCi,
        timeout: 90_000,
        env: {
          SCREENSHOT_FIXTURES: '1',
          INTERNAL_AUTH_SECRET: 'e2e-internal-auth-secret',
        },
      },
});
