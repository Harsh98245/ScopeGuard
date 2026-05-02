/**
 * @file tests/e2e/fixtures/mocks.ts
 * @description Playwright `page.route()` mocks for the third-party services
 *              the suite intercepts. Stripe Checkout and Plaid Link both
 *              hand off to provider-hosted UIs that Playwright cannot drive
 *              hermetically; we intercept the API calls that REQUEST those
 *              hand-offs and assert on the URL/payload instead of clicking
 *              through the provider's site.
 *
 *              Specs opt in per-test by calling the helpers below from
 *              `test.beforeEach` or inside a single test body. Calls to
 *              non-mocked URLs pass through to the real backend.
 */

import type { Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Anthropic (manual scope check + AI categoriser)
// ---------------------------------------------------------------------------

/**
 * Default scope-check verdict the mock returns. Tests that need a specific
 * verdict can override via the `verdict` parameter.
 */
export interface MockScopeCheckOptions {
  verdict?: 'IN_SCOPE' | 'OUT_OF_SCOPE' | 'AMBIGUOUS';
}

/**
 * Intercept POST /api/scope/check at the network layer so the test never
 * touches Anthropic. Returns a deterministic verdict response shaped like
 * the route's real output.
 *
 * Use when the spec runs against a dev server WITHOUT `ANTHROPIC_API_KEY`
 * configured — the real route would 500 in that case.
 */
export async function mockManualScopeCheck(
  page: Page,
  options: MockScopeCheckOptions = {},
): Promise<void> {
  const verdict = options.verdict ?? 'OUT_OF_SCOPE';
  await page.route('**/api/scope/check', async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: '00000000-0000-0000-0000-000000000001',
        verdict,
        confidence: 0.92,
        citedClause: 'Section 2.1 — Deliverables',
        clauseReference: 'Section 2.1',
        draftResponse: 'Thanks for the note — happy to chat.',
        changeOrderText: 'Mocked change-order text.',
        estimatedHours: 3.5,
        createdAt: new Date().toISOString(),
      }),
    });
  });
}

// ---------------------------------------------------------------------------
// Stripe Checkout / Customer Portal
// ---------------------------------------------------------------------------

/**
 * Replace POST /api/billing/checkout with a stub that returns a sentinel
 * URL. The spec asserts the redirect intent; we never actually navigate
 * to Stripe's hosted checkout (that's an out-of-scope flow for E2E).
 */
export async function mockBillingCheckout(page: Page): Promise<void> {
  await page.route('**/api/billing/checkout', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/MOCK' }),
    });
  });
  // Catch the actual redirect to the mocked URL so we don't leave the app.
  await page.route('https://checkout.stripe.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body><h1>Mocked Stripe Checkout</h1></body></html>',
    });
  });
}

/**
 * Replace POST /api/billing/portal with a stub URL. Same rationale as
 * checkout — Stripe Customer Portal lives off-app.
 */
export async function mockBillingPortal(page: Page): Promise<void> {
  await page.route('**/api/billing/portal', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: 'https://billing.stripe.com/p/session/MOCK' }),
    });
  });
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

/**
 * Mock POST /api/integrations/STRIPE/connect to return a fake OAuth URL.
 * The spec verifies the button triggers the request and that the payload
 * has the expected `mode: 'redirect'` shape.
 */
export async function mockStripeConnectStart(page: Page): Promise<void> {
  await page.route('**/api/integrations/STRIPE/connect', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'redirect',
        url: 'https://connect.stripe.com/oauth/authorize?mock=1',
      }),
    });
  });
  await page.route('https://connect.stripe.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body><h1>Mocked Stripe Connect</h1></body></html>',
    });
  });
}
