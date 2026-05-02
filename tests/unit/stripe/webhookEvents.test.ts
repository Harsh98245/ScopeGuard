/**
 * @file tests/unit/stripe/webhookEvents.test.ts
 * @description Tests for the pure helper `subscriptionStateFromStripe`. The
 *              `handle*` functions touch Prisma + the Stripe SDK, so they
 *              are exercised in a separate integration test (TBD); these
 *              tests pin down the deterministic mapping logic that drives them.
 *
 *              Critical invariants:
 *                - `active` and `trialing` statuses keep the user on their paid tier.
 *                - Any other status downgrades to FREE regardless of priceId.
 *                - Unknown priceIds → FREE (defensive — the webhook fired for a
 *                  price ID we don't have configured locally).
 *                - `current_period_end` is converted from Stripe's UNIX seconds
 *                  to a JS Date.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

import { subscriptionStateFromStripe } from '@/lib/stripe/webhookEvents';

beforeEach(() => {
  process.env['STRIPE_STARTER_PRICE_ID'] = 'price_starter_test';
  process.env['STRIPE_PRO_PRICE_ID'] = 'price_pro_test';
  process.env['STRIPE_BUSINESS_PRICE_ID'] = 'price_business_test';
});

afterEach(() => {
  delete process.env['STRIPE_STARTER_PRICE_ID'];
  delete process.env['STRIPE_PRO_PRICE_ID'];
  delete process.env['STRIPE_BUSINESS_PRICE_ID'];
  vi.unstubAllEnvs();
});

/**
 * Build a minimal Stripe.Subscription for testing. Only the fields read by
 * `subscriptionStateFromStripe` are populated; everything else is `undefined as never`
 * to keep the test data tight.
 */
function makeSubscription(overrides: {
  id?: string;
  status?: Stripe.Subscription.Status;
  priceId?: string | null;
  currentPeriodEnd?: number | null;
}): Stripe.Subscription {
  return {
    id: overrides.id ?? 'sub_test_123',
    status: overrides.status ?? 'active',
    current_period_end: overrides.currentPeriodEnd ?? 1_771_200_000,
    items: {
      object: 'list',
      data:
        overrides.priceId === null
          ? []
          : [
              {
                price: { id: overrides.priceId ?? 'price_pro_test' },
              } as Stripe.SubscriptionItem,
            ],
    } as Stripe.ApiList<Stripe.SubscriptionItem>,
    customer: 'cus_test',
  } as unknown as Stripe.Subscription;
}

describe('subscriptionStateFromStripe', () => {
  it('maps an active Pro subscription to PRO tier', () => {
    const sub = makeSubscription({ status: 'active', priceId: 'price_pro_test' });
    const state = subscriptionStateFromStripe(sub);

    expect(state).toEqual({
      stripeSubscriptionId: 'sub_test_123',
      stripePriceId: 'price_pro_test',
      subscriptionStatus: 'active',
      currentPeriodEnd: new Date(1_771_200_000 * 1000),
      planTier: 'PRO',
    });
  });

  it('maps an active Starter subscription to STARTER tier', () => {
    const sub = makeSubscription({ status: 'active', priceId: 'price_starter_test' });
    expect(subscriptionStateFromStripe(sub).planTier).toBe('STARTER');
  });

  it('maps an active Business subscription to BUSINESS tier', () => {
    const sub = makeSubscription({ status: 'active', priceId: 'price_business_test' });
    expect(subscriptionStateFromStripe(sub).planTier).toBe('BUSINESS');
  });

  it('treats `trialing` as a paid status (preserves tier)', () => {
    const sub = makeSubscription({ status: 'trialing', priceId: 'price_pro_test' });
    expect(subscriptionStateFromStripe(sub).planTier).toBe('PRO');
  });

  it('downgrades to FREE on `canceled` regardless of priceId', () => {
    const sub = makeSubscription({ status: 'canceled', priceId: 'price_pro_test' });
    const state = subscriptionStateFromStripe(sub);
    expect(state.planTier).toBe('FREE');
    expect(state.subscriptionStatus).toBe('canceled');
    // priceId is preserved so the UI can still show "was on Pro".
    expect(state.stripePriceId).toBe('price_pro_test');
  });

  it('downgrades to FREE on `past_due`', () => {
    const sub = makeSubscription({ status: 'past_due', priceId: 'price_pro_test' });
    expect(subscriptionStateFromStripe(sub).planTier).toBe('FREE');
  });

  it('downgrades to FREE on `unpaid`', () => {
    const sub = makeSubscription({ status: 'unpaid', priceId: 'price_pro_test' });
    expect(subscriptionStateFromStripe(sub).planTier).toBe('FREE');
  });

  it('downgrades to FREE on `incomplete_expired`', () => {
    const sub = makeSubscription({ status: 'incomplete_expired', priceId: 'price_pro_test' });
    expect(subscriptionStateFromStripe(sub).planTier).toBe('FREE');
  });

  it('downgrades to FREE when the priceId is unknown', () => {
    const sub = makeSubscription({ status: 'active', priceId: 'price_unknown' });
    expect(subscriptionStateFromStripe(sub).planTier).toBe('FREE');
  });

  it('handles a missing line item gracefully', () => {
    const sub = makeSubscription({ status: 'active', priceId: null });
    const state = subscriptionStateFromStripe(sub);
    expect(state.stripePriceId).toBeNull();
    expect(state.planTier).toBe('FREE');
  });

  it('converts current_period_end from UNIX seconds to a Date', () => {
    const sub = makeSubscription({
      status: 'active',
      priceId: 'price_pro_test',
      currentPeriodEnd: 1_700_000_000,
    });
    expect(subscriptionStateFromStripe(sub).currentPeriodEnd).toEqual(
      new Date(1_700_000_000 * 1000),
    );
  });
});
