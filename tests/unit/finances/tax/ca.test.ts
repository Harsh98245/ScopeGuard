/**
 * @file tests/unit/finances/tax/ca.test.ts
 * @description Sanity tests for the CA estimator. These pin the bracket
 *              schedule + CPP math against quick spot-check arithmetic.
 */

import { describe, expect, it } from 'vitest';

import { cppContributions, estimateTaxCA } from '@/lib/finances/tax/ca';

describe('cppContributions', () => {
  it('returns 0 below the basic exemption', () => {
    expect(cppContributions(2_000)).toBe(0);
    expect(cppContributions(3_500)).toBe(0);
  });

  it('applies 11.9% on (income − $3,500) below the YMPE', () => {
    // 50k → (50000 − 3500) × 0.119 = 5,533.50
    expect(cppContributions(50_000)).toBeCloseTo(5_533.5, 1);
  });

  it('caps at YMPE ($68,500) regardless of income', () => {
    expect(cppContributions(200_000)).toBeCloseTo((68_500 - 3_500) * 0.119, 1);
  });
});

describe('estimateTaxCA', () => {
  it('rejects non-CAD currency', () => {
    expect(() => estimateTaxCA({ annualNetIncome: '1000', currency: 'USD' })).toThrow(/CAD/);
  });

  it('returns zero tax on zero income', () => {
    const result = estimateTaxCA({ annualNetIncome: '0', currency: 'CAD' });
    expect(result.estimatedAnnualTax).toBe('0.00');
    expect(result.lineItems).toHaveLength(3);
  });

  it('produces a plausible total for $90k CAD net income', () => {
    const result = estimateTaxCA({ annualNetIncome: '90000', currency: 'CAD' });
    const annual = Number(result.estimatedAnnualTax);
    // Federal+ON+CPP at $90k should land somewhere in the $20-26k range.
    expect(annual).toBeGreaterThan(18_000);
    expect(annual).toBeLessThan(28_000);
  });

  it('includes a CPP line item, federal, and Ontario', () => {
    const result = estimateTaxCA({ annualNetIncome: '60000', currency: 'CAD' });
    const labels = result.lineItems.map((l) => l.label);
    expect(labels).toEqual([
      'CPP contributions (self-employed)',
      'Federal income tax',
      'Ontario provincial tax',
    ]);
  });

  it('quarterly is exactly annual / 4', () => {
    const result = estimateTaxCA({ annualNetIncome: '120000', currency: 'CAD' });
    expect(Number(result.estimatedQuarterly)).toBeCloseTo(
      Number(result.estimatedAnnualTax) / 4,
      2,
    );
  });
});
