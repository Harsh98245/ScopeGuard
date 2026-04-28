/**
 * @file tests/unit/utils/currency.test.ts
 * @description Sanity tests for currency arithmetic. Run before any change to
 *              lib/utils/currency.ts — money bugs are not worth shipping.
 */

import { describe, expect, it } from 'vitest';
import { formatMoney, fromMinor, sumMoney, toMinor } from '@/lib/utils/currency';

describe('toMinor / fromMinor', () => {
  it('round-trips integer values', () => {
    expect(toMinor('1234.56')).toBe(123456n);
    expect(fromMinor(123456n)).toBe('1234.56');
  });
  it('round-trips zero-fraction values', () => {
    expect(toMinor('5')).toBe(500n);
    expect(fromMinor(500n)).toBe('5.00');
  });
  it('rejects too many fractional digits', () => {
    expect(() => toMinor('1.234')).toThrow();
  });
});

describe('sumMoney', () => {
  it('sums without floating-point drift', () => {
    expect(sumMoney(['0.10', '0.20', '0.30'])).toBe('0.60');
    expect(sumMoney(['10.00', '0.99', '0.01'])).toBe('11.00');
  });
});

describe('formatMoney', () => {
  it('formats USD with locale en-US', () => {
    expect(formatMoney('1234.56', 'USD', 'en-US')).toBe('$1,234.56');
  });
  it('accepts bigint minor units', () => {
    expect(formatMoney(123456n, 'USD', 'en-US')).toBe('$1,234.56');
  });
});
