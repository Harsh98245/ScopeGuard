/**
 * @file lib/utils/currency.ts
 * @description Currency formatting and arithmetic helpers. Always uses the
 *              browser/Node `Intl.NumberFormat` for locale-correct rendering
 *              and never floats for arithmetic — money is held in minor units
 *              (cents) when computed, formatted only at the edge.
 *
 * @author ScopeGuard
 * @lastModified 2026-04-27
 */

/**
 * Convert a major-unit decimal string from Postgres (e.g. `"1234.56"`) to
 * minor units as a bigint (e.g. `123456n`).
 *
 * @param majorDecimal - Decimal string with at most 2 fractional digits.
 * @returns Minor-unit bigint.
 * @throws Error on a non-numeric or over-precise input.
 *
 * @example
 *   toMinor('1234.56') // 123456n
 *   toMinor('0.5')     // 50n
 */
export function toMinor(majorDecimal: string): bigint {
  if (!/^-?\d+(\.\d{1,2})?$/.test(majorDecimal)) {
    throw new Error(`toMinor: invalid currency string "${majorDecimal}"`);
  }
  const [whole, frac = ''] = majorDecimal.split('.') as [string, string?];
  const padded = (frac ?? '').padEnd(2, '0');
  return BigInt(whole + padded);
}

/**
 * Convert minor units back to a major-unit decimal string with exactly two
 * fractional digits. Round-trip safe with {@link toMinor}.
 *
 * @param minor - bigint amount in minor units.
 * @returns Major-unit decimal string.
 *
 * @example
 *   fromMinor(123456n) // "1234.56"
 */
export function fromMinor(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const fracStr = frac.toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fracStr}`;
}

/**
 * Format an amount for display in the user's locale.
 *
 * @param amount - Number, decimal string, or bigint (minor units).
 * @param currency - ISO 4217 code (e.g. `"USD"`, `"CAD"`, `"GBP"`).
 * @param locale - BCP 47 locale tag. Defaults to user's environment.
 * @returns Localised currency string, e.g. `"$1,234.56"`.
 *
 * @example
 *   formatMoney('1234.56', 'USD', 'en-US') // "$1,234.56"
 *   formatMoney(2400n,     'USD', 'en-US') // "$24.00" (bigint = minor units)
 */
export function formatMoney(
  amount: number | string | bigint,
  currency: string,
  locale?: string,
): string {
  let major: number;
  if (typeof amount === 'bigint') {
    major = Number(amount) / 100;
  } else if (typeof amount === 'string') {
    major = Number(amount);
  } else {
    major = amount;
  }

  if (!Number.isFinite(major)) {
    throw new Error(`formatMoney: not a finite number: ${String(amount)}`);
  }

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(major);
}

/**
 * Sum a list of major-unit decimal strings without floating-point drift.
 *
 * @param values - Array of decimal strings.
 * @returns Decimal-string total (always two fractional digits).
 *
 * @example
 *   sumMoney(['10.00', '0.99', '0.01']) // "11.00"
 */
export function sumMoney(values: readonly string[]): string {
  let total = 0n;
  for (const v of values) total += toMinor(v);
  return fromMinor(total);
}
