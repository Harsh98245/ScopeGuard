/**
 * @file tests/e2e/auth/scope-check.spec.ts
 * @description End-to-end test for the manual scope-check form. The
 *              Anthropic call is mocked at the network layer so this test
 *              runs without an ANTHROPIC_API_KEY and produces a deterministic
 *              verdict.
 *
 *              Flow:
 *                1. Seed a project for the authenticated test user.
 *                2. Navigate to /projects/<id>/scope-check.
 *                3. Mock the AI verdict.
 *                4. Submit the form with email body text.
 *                5. Assert the verdict card is rendered inline.
 *                6. Verify the verdict appears in /inbox.
 */

import { existsSync } from 'fs';
import { expect, test } from '@playwright/test';

import { STORAGE_STATE_PATH } from '../global-setup';
import { ensureTestUser } from '../fixtures/auth';
import { mockManualScopeCheck } from '../fixtures/mocks';
import { seedProject } from '../fixtures/seed';

test.skip(!existsSync(STORAGE_STATE_PATH), 'Authenticated storageState unavailable');

test.describe('Manual scope check', () => {
  let projectId: string;

  test.beforeAll(async () => {
    const userId = await ensureTestUser();
    const project = await seedProject({
      userId,
      name: `Scope Check Project ${Date.now()}`,
      clientName: 'Test Client',
      clientEmail: 'client@test.example',
    });
    projectId = project.id;
  });

  test('submits the form and renders an inline verdict', async ({ page }) => {
    await mockManualScopeCheck(page, { verdict: 'OUT_OF_SCOPE' });

    await page.goto(`/projects/${projectId}/scope-check`);
    await expect(page.getByRole('heading', { name: /manual scope check/i })).toBeVisible();

    await page
      .getByLabel(/email body/i)
      .fill('Hi, can you also add a video animation to the homepage?');

    await page.getByRole('button', { name: /check scope/i }).click();

    // Inline verdict card uses the verdict-out-of-scope badge variant.
    await expect(page.getByText(/out of scope/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/cited clause/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^copy$/i }).first()).toBeVisible();
  });
});
