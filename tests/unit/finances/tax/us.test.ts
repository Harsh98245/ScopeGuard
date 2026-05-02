/**
 * @file tests/unit/finances/tax/us.test.ts
 * @description Bracket-math tests for the US tax estimator. Pin reference
 *              outputs against IRS publication arithmetic so the constants
 *              don't silently drift between tax years.
 */

import { describe, expect, it } from 'vitest';

import { estimateTaxUS, selfEmploymentTax } from '@/lib/finances/tax/us';

describe('selfEmploymentTax', () => {
  it('returns 0 on zero income', () => {
    expect(selfEmploymentTax(0)).toBe(0);
  });

  it('applies 15.3% × 0.9235 below the SS wage base', () => {
    // $50k SE income → 50000 × 0.9235 × 0.153 = 7064.78 (approx)
    const tax = selfEmploymentTax(50_000);
    expect(tax).toBeCloseTo(7_064.78, 1);
  });

  it('caps the SS portion at the 2024 wage base ($168,600)', () => {
    // $300k SE income — Medicare keeps applying, SS stops at the wage base.
    const tax = selfEmploymentTax(300_000);
    // Pure SE-tax math: 0.9235*0.124*168600 + 0.9235*300000*0.029
    // = 19308.13 + 8034.45 = 27342.58
    expect(tax).toBeCloseTo(27_342.58, 1);
  });
});

describe('estimateTaxUS', () => {
  it('rejects non-USD currency', () => {
    expect(() => estimateTaxUS({ annualNetIncome: '1000', currency: 'CAD' })).toThrow(/USD/);
  });

  it('returns zero tax on zero net income', () => {
    const result = estimateTaxUS({ annualNetIncome: '0', currency: 'USD' });
    expect(result.estimatedAnnualTax).toBe('0.00');
    expect(result.estimatedQuarterly).toBe('0.00');
    expect(result.effectiveRate).toBe(0);
    expect(result.lineItems).toHaveLength(2);
  });

  it('computes a plausible total for $80k net SE income', () => {
    const result = estimateTaxUS({ annualNetIncome: '80000', currency: 'USD' });
    // Loose expectation: quarterly between $3.5k and $5k for $80k net.
    const quarterly = Number(result.estimatedQuarterly);
    expect(quarterly).toBeGreaterThan(3_500);
    expect(quarterly).toBeLessThan(5_500);
    expect(result.effectiveRate).toBeGreaterThan(0.18);
    expect(result.effectiveRate).toBeLessThan(0.25);
  });

  it('quarterly is exactly annual / 4', () => {
    const result = estimateTaxUS({ annualNetIncome: '120000', currency: 'USD' });
    const annual = Number(result.estimatedAnnualTax);
    const quarterly = Number(result.estimatedQuarterly);
    expect(quarterly).toBeCloseTo(annual / 4, 2);
  });

  it('exposes a state-tax disclaimer note', () => {
    const result = estimateTaxUS({ annualNetIncome: '100000', currency: 'USD' });
    const joined = result.notes.join(' ');
    expect(joined).toMatch(/state/i);
  });
});
