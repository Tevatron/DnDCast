import { defineConfig, devices } from '@playwright/test';

const E2E_PORT = 3999;
const BASE_URL = process.env.BASE_URL;   // set to target a live server instead of localhost

export default defineConfig({
  testDir:  './tests/e2e',
  timeout:  30_000,
  retries:  0,
  workers:  1,          // single worker — all tests share one server and data dir
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL:    BASE_URL ?? `http://localhost:${E2E_PORT}`,
    trace:      'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Skip local server when targeting a live URL.
  ...(BASE_URL ? {} : {
    webServer: {
      command:             `node tests/e2e/test-server.js`,
      url:                 `http://localhost:${E2E_PORT}`,
      reuseExistingServer: false,
      stdout:              'pipe',
      stderr:              'pipe',
      env: {
        E2E_PORT:     String(E2E_PORT),
        E2E_PASSWORD: 'e2e-test-password',
      },
    },
  }),
});
