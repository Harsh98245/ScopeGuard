/**
 * @file lib/stripe/client.ts
 * @description Server-side Stripe client singleton. Pinned to a known API
 *              version so SDK upgrades cannot silently change the wire format.
 *              When Stripe announces a new API version, bump deliberately.
 */

import Stripe from 'stripe';

let _stripe: Stripe | null = null;

/**
 * Lazy Stripe instance. The constructor reads STRIPE_SECRET_KEY at first call
 * so unit tests can run without the env var present.
 *
 * @returns Configured Stripe SDK instance.
 */
export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env['STRIPE_SECRET_KEY'];
  if (!key) throw new Error('STRIPE_SECRET_KEY is required.');
  _stripe = new Stripe(key, {
    apiVersion: '2024-10-28.acacia',
    typescript: true,
    appInfo: { name: 'ScopeGuard', version: '0.1.0' },
  });
  return _stripe;
}
