/**
 * @file tests/unit/integrations/registry.test.ts
 * @description Smoke tests for the integration registry. The registry is
 *              the only place that knows the source → driver mapping; these
 *              tests guard against accidentally orphaning a driver or
 *              registering one under the wrong source.
 */

import { describe, expect, it } from 'vitest';

import {
  AVAILABLE_SOURCES,
  describeDrivers,
  getDriver,
} from '@/lib/integrations/registry';

describe('getDriver', () => {
  it('returns the Stripe driver for STRIPE', () => {
    const d = getDriver('STRIPE');
    expect(d).not.toBeNull();
    expect(d!.source).toBe('STRIPE');
    expect(d!.displayName).toMatch(/Stripe/);
  });

  it('returns the PayPal driver for PAYPAL', () => {
    expect(getDriver('PAYPAL')!.source).toBe('PAYPAL');
  });

  it('returns the Plaid driver for PLAID', () => {
    expect(getDriver('PLAID')!.source).toBe('PLAID');
  });

  it('returns null for unsupported sources', () => {
    expect(getDriver('GUMROAD')).toBeNull();
    expect(getDriver('SHOPIFY')).toBeNull();
    expect(getDriver('ETSY')).toBeNull();
    expect(getDriver('UPWORK')).toBeNull();
    expect(getDriver('WISE')).toBeNull();
  });
});

describe('AVAILABLE_SOURCES', () => {
  it('exposes STRIPE / PAYPAL / PLAID exactly', () => {
    expect(AVAILABLE_SOURCES.sort()).toEqual(['PAYPAL', 'PLAID', 'STRIPE']);
  });
});

describe('describeDrivers', () => {
  it('returns one descriptor per available source with required UI fields', () => {
    const descriptors = describeDrivers();
    expect(descriptors).toHaveLength(3);
    for (const d of descriptors) {
      expect(d.displayName.length).toBeGreaterThan(0);
      expect(d.tagline.length).toBeGreaterThan(0);
      expect(typeof d.inPageConnect).toBe('boolean');
    }
  });

  it('marks Plaid (and only Plaid) as inPageConnect', () => {
    const descriptors = describeDrivers();
    const plaid = descriptors.find((d) => d.source === 'PLAID');
    const stripe = descriptors.find((d) => d.source === 'STRIPE');
    expect(plaid?.inPageConnect).toBe(true);
    expect(stripe?.inPageConnect).toBe(false);
  });
});
