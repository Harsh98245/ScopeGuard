/**
 * @file tests/e2e/auth/billing.spec.ts
 * @description Billing surface E2E. Verifies the pricing table renders all
 *              three tiers and that clicking Upgrade kicks off the
 *              `/api/billing/checkout` request. The actual Stripe Checkout
 *              page is intercepted by `mockBillingCheckout` so the test
 *              never leaves the app.
 */

import { existsSync } from 'fs';
import { expect, test } from '@playwright/test';

import { STORAGE_STATE_PATH } from '../global-setup';
import { mockBillingCheckout, mockBillingPortal } from '../fixtures/mocks';

test.skip(!existsSync(STORAGE_STATE_PATH), 'Authenticated storageState unavailable');

test.describe('Billing & plans', () => {
  test('lands on /settings/billing with pricing + subscription cards', async ({ page }) => {
    await page.goto('/settings/billing');
    await expect(page.getByRole('heading', { name: /billing/i })).toBeVisible();

    await expect(page.getByText(/current plan/i)).toBeVisible();
    await expect(page.getByText(/^starter$/i)).toBeVisible();
    await expect(page.getByText(/^pro$/i)).toBeVisible();
    await expect(page.getByText(/^business$/i)).toBeVisible();
  });

  test('Upgrade button POSTs to /api/billing/checkout and redirects to the URL', async ({
    page,
  }) => {
    await mockBillingCheckout(page);
    await mockBillingPortal(page);

    await page.goto('/settings/billing');

    // Filter to the first non-disabled "Upgrade" — STARTER for a FREE user.
    const upgradeButton = page.getByRole('button', { name: /^upgrade$/i }).first();
    await expect(upgradeButton).toBeVisible();

    await Promise.all([
      page.waitForURL(/checkout\.stripe\.com/),
      upgradeButton.click(),
    ]);

    // The mocked Stripe Checkout shell is served by the route mock.
    await expect(page.locator('body')).toContainText('Mocked Stripe Checkout');
  });

  test('checkout-success banner renders when ?checkout=success', async ({ page }) => {
    await page.goto('/settings/billing?checkout=success');
    await expect(page.getByText(/subscription started/i)).toBeVisible();
  });

  test('checkout-cancelled banner renders when ?checkout=cancelled', async ({ page }) => {
    await page.goto('/settings/billing?checkout=cancelled');
    await expect(page.getByText(/checkout cancelled/i)).toBeVisible();
  });
});
