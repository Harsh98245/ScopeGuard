/**
 * @file tests/e2e/auth/projects.spec.ts
 * @description End-to-end tests for the project-creation flow. Runs as the
 *              storage-state-authenticated test user provisioned in
 *              `global-setup.ts`. Each test creates a uniquely-named project
 *              so reruns don't collide.
 */

import { existsSync } from 'fs';
import { expect, test } from '@playwright/test';

import { STORAGE_STATE_PATH } from '../global-setup';

// Soft-skip when global-setup didn't write a storageState (admin env vars missing).
test.skip(!existsSync(STORAGE_STATE_PATH), 'Authenticated storageState unavailable');

test.describe('Projects', () => {
  test('signed-in user lands on /projects from the dashboard nav', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: /projects/i }).first()).toBeVisible();
  });

  test('creates a new project end-to-end', async ({ page }) => {
    const uniqueName = `E2E Project ${Date.now()}`;

    await page.goto('/projects/new');
    await expect(page.getByRole('heading', { name: /new project/i })).toBeVisible();

    await page.getByLabel(/^name/i).fill(uniqueName);
    await page.getByLabel(/client name/i).fill('Acme Corp');
    await page.getByLabel(/client email/i).fill('billing@acme.test');

    await Promise.all([
      page.waitForURL(/\/projects\/[0-9a-f-]{36}$/),
      page.getByRole('button', { name: /create/i }).click(),
    ]);

    // Project detail page should show the new project's name.
    await expect(page.getByRole('heading', { name: uniqueName })).toBeVisible();
  });

  test('lists projects on /projects', async ({ page }) => {
    await page.goto('/projects');
    // The header is always present; the empty-state OR a card grid follows.
    // We tolerate either — the test only asserts no error page.
    const errorMarker = page.getByText(/something went wrong/i);
    await expect(errorMarker).toHaveCount(0);
  });
});
