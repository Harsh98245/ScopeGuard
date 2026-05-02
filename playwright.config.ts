/**
 * @file playwright.config.ts
 * @description Playwright config for end-to-end tests. Boots the Next.js dev
 *              server (or relies on PLAYWRIGHT_BASE_URL in CI) and runs the
 *              spec suite in tests/e2e.
 *
 *              Two project shapes:
 *                - `chromium-public` runs every spec in `tests/e2e/public/`
 *                  with no stored auth — covers the landing + login pages.
 *                - `chromium-auth` runs every spec in `tests/e2e/auth/`
 *                  with the storageState produced by `global-setup.ts`.
 *
 *              The Firefox + WebKit cross-browser projects only run in CI
 *              to keep local dev iteration fast.
 */

import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['PORT'] ?? 3000);
const baseURL = process.env['PLAYWRIGHT_BASE_URL'] ?? `http://localhost:${PORT}`;
const STORAGE_STATE_PATH = 'tests/e2e/.auth/user.json';
const inCI = !!process.env['CI'];

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: inCI,
  retries: inCI ? 2 : 0,
  workers: inCI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-public',
      testDir: './tests/e2e/public',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-auth',
      testDir: './tests/e2e/auth',
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE_PATH },
    },
    // Cross-browser coverage in CI only.
    ...(inCI
      ? [
          {
            name: 'firefox-public',
            testDir: './tests/e2e/public',
            use: { ...devices['Desktop Firefox'] },
          },
          {
            name: 'webkit-public',
            testDir: './tests/e2e/public',
            use: { ...devices['Desktop Safari'] },
          },
        ]
      : []),
  ],
  webServer: process.env['PLAYWRIGHT_BASE_URL']
    ? undefined
    : {
        command: 'pnpm dev',
        url: baseURL,
        timeout: 120_000,
        reuseExistingServer: !inCI,
      },
});
