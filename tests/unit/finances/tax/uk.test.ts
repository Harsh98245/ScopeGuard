/**
 * @file tests/unit/finances/tax/uk.test.ts
 * @description Tests for the UK Self-Assessment estimator. Pin reference
 *              outputs against HMRC-style hand math.
 */

import { describe, expect, it } from 'vitest';

import { class4Nics, estimateTaxUK, taperedAllowance } from '@/lib/finances/tax/uk';

describe('class4Nics', () => {
  it('is 0 below the lower profits limit', () => {
    expect(class4Nics(10_000)).toBe(0);
    expect(class4Nics(12_570)).toBe(0);
  });

  it('charges 6% between the lower and upper limits', () => {
    // 30k → (30000 − 12570) × 0.06 = 1045.80
    expect(class4Nics(30_000)).toBeCloseTo(1_045.8, 1);
  });

  it('charges 2% above the upper limit (50,270)', () => {
    // 80k → main: (50270 − 12570) × 0.06 = 2262
    //       upper: (80000 − 50270) × 0.02 = 594.6
    //       total: 2856.6
    expect(class4Nics(80_000)).toBeCloseTo(2_856.6, 1);
  });
});

describe('taperedAllowance', () => {
  it('keeps the full personal allowance below £100k', () => {
    expect(taperedAllowance(50_000)).toBe(12_570);
    expect(taperedAllowance(99_999)).toBe(12_570);
  });

  it('tapers £1 for every £2 above £100k', () => {
    expect(taperedAllowance(110_000)).toBe(12_570 - 5_000);
  });

  it('reduces to 0 at £125,140', () => {
    expect(taperedAllowance(125_140)).toBe(0);
    expect(taperedAllowance(200_000)).toBe(0);
  });
});

describe('estimateTaxUK', () => {
  it('rejects non-GBP currency', () => {
    expect(() => estimateTaxUK({ annualNetIncome: '1000', currency: 'USD' })).toThrow(/GBP/);
  });

  it('returns zero tax on zero profit', () => {
    const result = estimateTaxUK({ annualNetIncome: '0', currency: 'GBP' });
    expect(result.estimatedAnnualTax).toBe('0.00');
  });

  it('produces a plausible total for £40k profit', () => {
    const result = estimateTaxUK({ annualNetIncome: '40000', currency: 'GBP' });
    const total = Number(result.estimatedAnnualTax);
    // Income tax: (40000 − 12570) × 0.20 = 5486
    // Class 4 NICs: (40000 − 12570) × 0.06 = 1645.80
    // Total: 7131.80
    expect(total).toBeCloseTo(7_131.8, 1);
  });

  it('crosses the higher rate threshold cleanly at £50,270', () => {
    const result = estimateTaxUK({ annualNetIncome: '60000', currency: 'GBP' });
    const total = Number(result.estimatedAnnualTax);
    expect(total).toBeGreaterThan(13_000);
    expect(total).toBeLessThan(17_000);
  });

  it('lists income tax + Class 4 NICs as the two line items', () => {
    const result = estimateTaxUK({ annualNetIncome: '30000', currency: 'GBP' });
    expect(result.lineItems.map((l) => l.label)).toEqual(['Income tax', 'Class 4 NICs']);
  });
});
