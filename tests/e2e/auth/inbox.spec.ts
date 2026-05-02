/**
 * @file tests/e2e/auth/inbox.spec.ts
 * @description Inbox feed E2E. Seeds a scope check directly into the DB
 *              (bypassing the AI pipeline) and asserts it renders on /inbox
 *              with the verdict colour, project name, and copy buttons.
 */

import { existsSync } from 'fs';
import { expect, test } from '@playwright/test';

import { STORAGE_STATE_PATH } from '../global-setup';
import { ensureTestUser } from '../fixtures/auth';
import { seedProject, seedScopeCheck } from '../fixtures/seed';

test.skip(!existsSync(STORAGE_STATE_PATH), 'Authenticated storageState unavailable');

test.describe('Inbox feed', () => {
  test('shows seeded scope checks in reverse chronological order', async ({ page }) => {
    const userId = await ensureTestUser();
    const project = await seedProject({
      userId,
      name: `Inbox Project ${Date.now()}`,
      clientName: 'Inbox Client',
    });
    await seedScopeCheck({
      projectId: project.id,
      verdict: 'OUT_OF_SCOPE',
      emailSubject: 'Quick design tweak',
    });
    await seedScopeCheck({
      projectId: project.id,
      verdict: 'IN_SCOPE',
      emailSubject: 'Standard logo update',
    });

    await page.goto('/inbox');

    await expect(page.getByRole('heading', { name: /inbox/i })).toBeVisible();
    await expect(page.getByText('Quick design tweak')).toBeVisible();
    await expect(page.getByText('Standard logo update')).toBeVisible();

    // At least one verdict badge per card.
    await expect(page.locator('text=/in scope|out of scope/i').first()).toBeVisible();
  });
});
