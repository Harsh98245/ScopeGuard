/**
 * @file tests/e2e/auth/integrations.spec.ts
 * @description Integrations surface E2E. Verifies cards render for every
 *              registered driver and that the Stripe Connect button posts
 *              to /api/integrations/STRIPE/connect (mocked) and follows the
 *              returned URL.
 */

import { existsSync } from 'fs';
import { expect, test } from '@playwright/test';

import { STORAGE_STATE_PATH } from '../global-setup';
import { ensureTestUser, setUserPlanTier } from '../fixtures/auth';
import { mockStripeConnectStart } from '../fixtures/mocks';

test.skip(!existsSync(STORAGE_STATE_PATH), 'Authenticated storageState unavailable');

test.describe('Integrations surface (PRO)', () => {
  let userId: string;

  test.beforeAll(async () => {
    userId = await ensureTestUser();
    await setUserPlanTier(userId, 'PRO');
  });

  test.afterAll(async () => {
    await setUserPlanTier(userId, 'FREE');
  });

  test('renders one card per registered driver', async ({ page }) => {
    await page.goto('/settings/integrations');

    // describeDrivers() exposes 3 entries: STRIPE, PAYPAL, PLAID.
    await expect(page.getByText(/stripe/i).first()).toBeVisible();
    await expect(page.getByText(/paypal/i).first()).toBeVisible();
    await expect(page.getByText(/plaid/i).first()).toBeVisible();
  });

  test('each card has a Connect button while disconnected', async ({ page }) => {
    await page.goto('/settings/integrations');
    const connectButtons = page.getByRole('button', { name: /^connect$/i });
    expect(await connectButtons.count()).toBeGreaterThanOrEqual(3);
  });

  test('Stripe Connect button posts and follows the returned URL', async ({ page }) => {
    await mockStripeConnectStart(page);
    await page.goto('/settings/integrations');

    // Find the Stripe card by its display name and click its Connect button.
    const stripeCard = page
      .locator('div', { has: page.getByRole('heading', { name: /stripe/i }) })
      .first();
    const connect = stripeCard.getByRole('button', { name: /^connect$/i });

    await Promise.all([
      page.waitForURL(/connect\.stripe\.com/),
      connect.click(),
    ]);

    await expect(page.locator('body')).toContainText(/mocked stripe connect/i);
  });

  test('connected banner renders when ?connected=STRIPE', async ({ page }) => {
    await page.goto('/settings/integrations?connected=STRIPE');
    await expect(page.getByText(/connected/i).first()).toBeVisible();
  });

  test('error banner renders when ?error=callback_failed', async ({ page }) => {
    await page.goto('/settings/integrations?error=callback_failed');
    await expect(page.getByText(/connect failed/i)).toBeVisible();
    await expect(page.getByText(/callback_failed/)).toBeVisible();
  });
});
