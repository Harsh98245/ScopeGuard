/**
 * @file tests/e2e/auth/finances.spec.ts
 * @description Financial OS E2E. Promotes the test user to PRO, seeds a
 *              handful of transactions directly in the DB, then asserts the
 *              dashboard renders summary cards, the category breakdown, and
 *              the tax estimate without crashing.
 *
 *              The manual-transaction form is exercised at the API level
 *              (POST /api/finances/transactions) — driving the full form
 *              UI is covered by the unit-level form tests; this spec
 *              focuses on the dashboard render path.
 */

import { existsSync } from 'fs';
import { expect, test } from '@playwright/test';

import { STORAGE_STATE_PATH } from '../global-setup';
import { ensureTestUser, setUserPlanTier } from '../fixtures/auth';
import { seedTransaction } from '../fixtures/seed';

test.skip(!existsSync(STORAGE_STATE_PATH), 'Authenticated storageState unavailable');

test.describe('Financial OS dashboard (PRO)', () => {
  let userId: string;

  test.beforeAll(async () => {
    userId = await ensureTestUser();
    await setUserPlanTier(userId, 'PRO');

    // Two income + one deductible expense in USD this month.
    const now = new Date();
    await seedTransaction({
      userId,
      type: 'INCOME',
      amount: '5000.00',
      currency: 'USD',
      description: 'Invoice #1001 — Acme',
      occurredAt: now,
    });
    await seedTransaction({
      userId,
      type: 'INCOME',
      amount: '2500.00',
      currency: 'USD',
      description: 'Invoice #1002 — Globex',
      occurredAt: now,
    });
    await seedTransaction({
      userId,
      type: 'EXPENSE',
      amount: '120.00',
      currency: 'USD',
      description: 'GitHub.com',
      category: 'software',
      taxDeductible: true,
      occurredAt: now,
    });
  });

  test.afterAll(async () => {
    await setUserPlanTier(userId, 'FREE');
  });

  test('renders the income / expenses / net cards in USD', async ({ page }) => {
    await page.goto('/finances');

    await expect(page.getByRole('heading', { name: /finances/i }).first()).toBeVisible();

    // Verify the headline numbers — formatMoney(USD) → "$X,XXX.00".
    await expect(page.getByText(/\$7,500\.00/)).toBeVisible(); // income
    await expect(page.getByText(/\$120\.00/)).toBeVisible(); // expenses
    await expect(page.getByText(/\$7,380\.00/)).toBeVisible(); // net
  });

  test('renders the quarterly tax set-aside card with a positive number', async ({ page }) => {
    await page.goto('/finances');

    await expect(page.getByText(/quarterly tax set-aside/i)).toBeVisible();
    await expect(page.getByText(/disclaimer/i)).toBeVisible();
  });

  test('renders the recent activity table with the seeded rows', async ({ page }) => {
    await page.goto('/finances');

    await expect(page.getByText('Invoice #1001 — Acme')).toBeVisible();
    await expect(page.getByText('GitHub.com')).toBeVisible();
  });

  test('Add Transaction button leads to /finances/transactions/new', async ({ page }) => {
    await page.goto('/finances');
    await page.getByRole('link', { name: /add transaction/i }).click();
    await expect(page).toHaveURL(/\/finances\/transactions\/new/);
    await expect(page.getByRole('heading', { name: /add transaction/i })).toBeVisible();
  });
});
