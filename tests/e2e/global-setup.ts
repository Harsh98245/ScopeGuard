/**
 * @file tests/e2e/global-setup.ts
 * @description Runs once before any spec executes. Provisions a stable
 *              authenticated test user via the Supabase admin API, drives
 *              a real /login submission with that user's credentials, and
 *              persists the resulting browser cookies to `.auth/user.json`.
 *
 *              Spec files that need an authenticated context import the
 *              storage state via the `authenticated` Playwright project
 *              defined in `playwright.config.ts`.
 *
 *              Soft-skip behaviour: when the Supabase admin env vars are
 *              missing we log a friendly warning and skip storageState
 *              provisioning. Auth-dependent specs already check for the
 *              storage state file's existence and skip themselves.
 */

import { chromium, type FullConfig } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';

import {
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
  ensureTestUser,
  setUserPlanTier,
} from './fixtures/auth';

export const STORAGE_STATE_PATH = 'tests/e2e/.auth/user.json';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:3000';

  if (!process.env['SUPABASE_SERVICE_ROLE_KEY'] || !process.env['NEXT_PUBLIC_SUPABASE_URL']) {
    // eslint-disable-next-line no-console
    console.warn(
      '[e2e] Supabase admin env vars missing — skipping authenticated-storage provisioning. ' +
        'Auth-dependent specs will skip themselves.',
    );
    return;
  }

  // 1. Ensure the user exists at the auth layer.
  const userId = await ensureTestUser();

  // 2. Drive a real /login so the public users row + session cookies are
  //    provisioned by the same code path real users hit. We can't shortcut
  //    this with the admin API alone — `ensureUserProfile` runs inside
  //    the auth callback, and the SSR session cookies are set there too.
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();

    await page.goto('/login');
    await page.getByLabel('Email').fill(E2E_USER_EMAIL);
    await page.getByLabel('Password').fill(E2E_USER_PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 }),
      page.getByRole('button', { name: /sign in/i }).click(),
    ]);

    // 3. Capture the storage state (cookies + localStorage) for reuse.
    mkdirSync(dirname(STORAGE_STATE_PATH), { recursive: true });
    const state = await context.storageState();
    writeFileSync(STORAGE_STATE_PATH, JSON.stringify(state, null, 2));

    // 4. Reset the user back to FREE so each run starts from a known plan.
    //    Specs that need a paid tier flip it explicitly via setUserPlanTier.
    await setUserPlanTier(userId, 'FREE');
  } finally {
    await browser.close();
  }
}
