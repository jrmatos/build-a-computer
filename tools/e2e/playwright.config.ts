import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (docs/plan.md "Testing and quality"): a production build
 * served under /build-a-computer/, driven in Chromium, Firefox and WebKit,
 * plus touch emulation (EDIT-07) on a phone-sized WebKit and Chromium.
 * Run from the repo root with `pnpm e2e`.
 */
const port = Number(process.env.E2E_PORT ?? 4417);
const CI = !!process.env.CI;
const desktop = { viewport: { width: 1440, height: 900 } };
const TOUCH = /touch\.spec\.ts$/;

export default defineConfig({
  testDir: './tests',
  outputDir: './out/test-results',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: CI
    ? [['list'], ['html', { open: 'never', outputFolder: './out/report' }], ['github']]
    : [['list'], ['html', { open: 'never', outputFolder: './out/report' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}/build-a-computer/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', testIgnore: TOUCH, use: { ...devices['Desktop Chrome'], ...desktop } },
    { name: 'firefox', testIgnore: TOUCH, use: { ...devices['Desktop Firefox'], ...desktop } },
    { name: 'webkit', testIgnore: TOUCH, use: { ...devices['Desktop Safari'], ...desktop } },
    { name: 'mobile-webkit', testMatch: TOUCH, use: { ...devices['iPhone 13'] } },
    { name: 'mobile-chromium', testMatch: TOUCH, use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node server.ts',
    url: `http://127.0.0.1:${port}/build-a-computer/`,
    reuseExistingServer: !CI,
    timeout: 180_000,
  },
});
