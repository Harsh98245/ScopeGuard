/**
 * @file tests/e2e/public/landing.spec.ts
 * @description Smoke tests for the marketing landing page. Pure
 *              presentational checks — no auth, no DB, no third-party APIs.
 *              These tests are the canary that the dev server boots and
 *              the SSR pipeline renders cleanly across browsers.
 */

import { expect, test } from '@playwright/test';

test.describe('Landing page', () => {
  test('renders the hero copy and a sign-up CTA', async ({ page }) => {
    await page.goto('/');

    // The exact hero copy is in app/page.tsx — adjust the regex if the
    // marketing team rewords it. The fact that an h1 exists at all is the
    // primary contract.
    await expect(page.locator('h1').first()).toBeVisible();

    // At least one link to /signup or /login should be wired up.
    const signupLink = page.getByRole('link', { name: /sign\s?up|get started/i }).first();
    await expect(signupLink).toBeVisible();
  });

  test('does not leak protected paths via prefetch links', async ({ page }) => {
    await page.goto('/');
    // Anchors to /projects, /inbox, /finances would be a regression — those
    // require auth and the marketing page should not advertise them.
    const protectedLinks = page.locator('a[href^="/projects"], a[href^="/inbox"], a[href^="/finances"]');
    expect(await protectedLinks.count()).toBe(0);
  });

  test('returns a custom 404 for unknown paths', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist');
    expect(response?.status()).toBe(404);
    // The Not-Found page renders text including "not found" or similar.
    await expect(page.locator('body')).toContainText(/not found/i);
  });
});

test.describe('Health endpoint', () => {
  test('GET /api/health returns 200 with { ok: true }', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
