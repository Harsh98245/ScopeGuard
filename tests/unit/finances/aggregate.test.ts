/**
 * @file tests/unit/finances/aggregate.test.ts
 * @description Pure-function tests for the P&L aggregation helpers. No
 *              Prisma, no mocks — feed plain arrays in, assert deterministic
 *              decimal-string outputs. Critical: amounts are big-int math
 *              under the hood, so floating-point edge cases (e.g. 0.1 + 0.2)
 *              must round-trip cleanly.
 */

import { describe, expect, it } from 'vitest';

import {
  expenseByCategory,
  projectAnnualNet,
  summarise,
  type TransactionSubset,
} from '@/lib/finances/aggregate';

function tx(overrides: Partial<TransactionSubset>): TransactionSubset {
  return {
    amount: '0.00',
    currency: 'USD',
    type: 'EXPENSE',
    category: null,
    occurredAt: new Date('2026-04-15T12:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// summarise
// ---------------------------------------------------------------------------

describe('summarise', () => {
  it('returns an empty array for no transactions', () => {
    expect(summarise([])).toEqual([]);
  });

  it('separates income and expense by currency', () => {
    const result = summarise([
      tx({ amount: '1000.00', type: 'INCOME', currency: 'USD' }),
      tx({ amount: '250.50', type: 'EXPENSE', currency: 'USD' }),
      tx({ amount: '500.00', type: 'INCOME', currency: 'CAD' }),
    ]);
    expect(result).toEqual([
      { currency: 'USD', income: '1000.00', expense: '250.50', net: '749.50' },
      { currency: 'CAD', income: '500.00', expense: '0.00', net: '500.00' },
    ]);
  });

  it('handles fractions without floating drift (0.1 + 0.2 + 0.3 = 0.60)', () => {
    const result = summarise([
      tx({ amount: '0.10', type: 'EXPENSE' }),
      tx({ amount: '0.20', type: 'EXPENSE' }),
      tx({ amount: '0.30', type: 'EXPENSE' }),
    ]);
    expect(result[0]?.expense).toBe('0.60');
  });

  it('preserves first-occurrence currency order across calls', () => {
    const result = summarise([
      tx({ currency: 'GBP', amount: '5.00', type: 'INCOME' }),
      tx({ currency: 'USD', amount: '5.00', type: 'INCOME' }),
      tx({ currency: 'EUR', amount: '5.00', type: 'INCOME' }),
    ]);
    expect(result.map((b) => b.currency)).toEqual(['GBP', 'USD', 'EUR']);
  });

  it('produces a negative net when expenses exceed income', () => {
    const result = summarise([
      tx({ amount: '100.00', type: 'INCOME' }),
      tx({ amount: '300.00', type: 'EXPENSE' }),
    ]);
    expect(result[0]?.net).toBe('-200.00');
  });
});

// ---------------------------------------------------------------------------
// expenseByCategory
// ---------------------------------------------------------------------------

describe('expenseByCategory', () => {
  it('returns an empty array when there are no expenses', () => {
    expect(expenseByCategory([tx({ type: 'INCOME', amount: '100.00' })])).toEqual([]);
  });

  it('sums per category and returns descending shares', () => {
    const result = expenseByCategory([
      tx({ amount: '300.00', type: 'EXPENSE', category: 'software' }),
      tx({ amount: '100.00', type: 'EXPENSE', category: 'office' }),
      tx({ amount: '600.00', type: 'EXPENSE', category: 'software' }),
    ]);
    expect(result).toEqual([
      { category: 'software', total: '900.00', share: 0.9 },
      { category: 'office', total: '100.00', share: 0.1 },
    ]);
  });

  it('groups uncategorised expenses under "uncategorised"', () => {
    const result = expenseByCategory([
      tx({ amount: '50.00', type: 'EXPENSE', category: null }),
      tx({ amount: '50.00', type: 'EXPENSE', category: null }),
    ]);
    expect(result).toEqual([{ category: 'uncategorised', total: '100.00', share: 1 }]);
  });

  it('ignores INCOME rows', () => {
    const result = expenseByCategory([
      tx({ amount: '1000.00', type: 'INCOME', category: 'software' }),
      tx({ amount: '50.00', type: 'EXPENSE', category: 'software' }),
    ]);
    expect(result).toEqual([{ category: 'software', total: '50.00', share: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// projectAnnualNet
// ---------------------------------------------------------------------------

describe('projectAnnualNet', () => {
  it('returns 0.00 for zero or negative YTD net', () => {
    const apr15 = new Date('2026-04-15T12:00:00Z');
    expect(projectAnnualNet('0.00', apr15)).toBe('0.00');
    expect(projectAnnualNet('-100.00', apr15)).toBe('0.00');
  });

  it('annualises mid-April YTD net by ~3.4× (105 days elapsed)', () => {
    // Apr 15 = day 105 of 365 → 3.476× projection.
    const apr15 = new Date('2026-04-15T12:00:00Z');
    const projected = projectAnnualNet('10000.00', apr15);
    const numeric = Number(projected);
    expect(numeric).toBeGreaterThan(33_000);
    expect(numeric).toBeLessThan(36_000);
  });

  it('produces approximately the input on Dec 31', () => {
    const dec31 = new Date('2026-12-31T23:00:00Z');
    const projected = projectAnnualNet('50000.00', dec31);
    const numeric = Number(projected);
    expect(numeric).toBeGreaterThan(49_500);
    expect(numeric).toBeLessThan(50_500);
  });

  it('floors elapsed time at one day for very-early-year inputs', () => {
    const jan1Morning = new Date('2026-01-01T00:00:00Z');
    // No elapsed time → use 1/365 fraction so projection is income × 365.
    const projected = projectAnnualNet('100.00', jan1Morning);
    expect(Number(projected)).toBeGreaterThanOrEqual(36_500);
  });
});
