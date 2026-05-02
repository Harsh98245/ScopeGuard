/**
 * @file tests/e2e/public/auth-forms.spec.ts
 * @description Validation-only tests for the signup + login forms. We DO
 *              NOT submit real signups (those require an email-confirmation
 *              loop beyond the suite's scope) — the goal is to exercise the
 *              client-side validation and the server-action error branches.
 */

import { expect, test } from '@playwright/test';

test.describe('Login form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('renders the form with email + password fields', async ({ page }) => {
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('rejects submission with no email', async ({ page }) => {
    await page.getByLabel('Password').fill('anything');
    await page.getByRole('button', { name: /sign in/i }).click();
    // Browser-native validation OR server-side Zod error. Either path keeps
    // the user on /login.
    await expect(page).toHaveURL(/\/login/);
  });

  test('exposes a Google OAuth entry point', async ({ page }) => {
    await expect(page.getByRole('button', { name: /google/i })).toBeVisible();
  });

  test('links to /signup', async ({ page }) => {
    await expect(page.getByRole('link', { name: /sign\s?up/i })).toBeVisible();
  });
});

test.describe('Signup form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/signup');
  });

  test('renders the form with email + password fields', async ({ page }) => {
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('captures the browser timezone in a hidden field', async ({ page }) => {
    // The signup form's client island reads `Intl.DateTimeFormat().resolvedOptions().timeZone`
    // and stuffs it into a hidden input named `timezone`. We assert the
    // field exists and is non-empty so a future refactor doesn't silently
    // drop the value (which then defaults to America/Toronto in Prisma).
    const tzField = page.locator('input[name="timezone"]');
    await expect(tzField).toHaveCount(1);
    const value = await tzField.inputValue();
    expect(value.length).toBeGreaterThan(0);
  });
});

test.describe('Middleware redirects', () => {
  test('redirects /projects to /login when unauthenticated', async ({ page }) => {
    const response = await page.goto('/projects');
    // Either the middleware redirected via 30x or we landed on /login via SSR.
    await expect(page).toHaveURL(/\/login/);
    expect(response?.status()).toBeLessThan(400);
  });

  test('redirects /finances to /login when unauthenticated', async ({ page }) => {
    await page.goto('/finances');
    await expect(page).toHaveURL(/\/login/);
  });
});
