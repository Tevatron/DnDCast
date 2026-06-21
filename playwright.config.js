import { defineConfig, devices } from '@playwright/test';

const E2E_PORT = 3999;

export default defineConfig({
  testDir:  './tests/e2e',
  timeout:  30_000,
  retries:  0,
  workers:  1,          // single worker — all tests share one server and data dir
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL:     `http://localhost:${E2E_PORT}`,
    trace:       'on-first-retry',
    screenshot:  'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    command:            `node tests/e2e/test-server.js`,
    url:                `http://localhost:${E2E_PORT}`,
    reuseExistingServer: false,
    stdout:             'pipe',
    stderr:             'pipe',
    env: {
      E2E_PORT:     String(E2E_PORT),
      E2E_PASSWORD: 'e2e-test-password',
    },
  },
});
