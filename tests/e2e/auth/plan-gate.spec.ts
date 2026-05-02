/**
 * @file tests/e2e/auth/plan-gate.spec.ts
 * @description Verifies the FREE→PRO plan gate on /finances and
 *              /settings/integrations. Flips the test user's `planTier`
 *              between runs via the Supabase admin API and asserts the
 *              upgrade card vs. the dashboard render correctly.
 *
 *              Tear-down restores the user to FREE so other auth specs
 *              run from the same baseline.
 */

import { existsSync } from 'fs';
import { expect, test } from '@playwright/test';

import { STORAGE_STATE_PATH } from '../global-setup';
import { ensureTestUser, setUserPlanTier } from '../fixtures/auth';

test.skip(!existsSync(STORAGE_STATE_PATH), 'Authenticated storageState unavailable');

test.describe('Plan gate — Financial OS', () => {
  test.afterEach(async () => {
    const userId = await ensureTestUser();
    await setUserPlanTier(userId, 'FREE');
  });

  test('FREE user sees the upgrade card on /finances', async ({ page }) => {
    const userId = await ensureTestUser();
    await setUserPlanTier(userId, 'FREE');

    await page.goto('/finances');
    await expect(page.getByText(/financial os/i).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /view plans/i })).toBeVisible();
  });

  test('STARTER user also sees the upgrade card', async ({ page }) => {
    const userId = await ensureTestUser();
    await setUserPlanTier(userId, 'STARTER');

    await page.goto('/finances');
    await expect(page.getByRole('link', { name: /view plans/i })).toBeVisible();
  });

  test('PRO user sees the dashboard (Add transaction button)', async ({ page }) => {
    const userId = await ensureTestUser();
    await setUserPlanTier(userId, 'PRO');

    await page.goto('/finances');
    await expect(page.getByRole('link', { name: /add transaction/i })).toBeVisible();
  });

  test('FREE user sees the upgrade card on /settings/integrations', async ({ page }) => {
    const userId = await ensureTestUser();
    await setUserPlanTier(userId, 'FREE');

    await page.goto('/settings/integrations');
    await expect(page.getByText(/integrations/i).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /view plans/i })).toBeVisible();
  });
});
