/**
 * @file lib/finances/aggregate.ts
 * @description Pure aggregation helpers for the Financial OS — P&L summaries,
 *              category breakdowns, and currency-aware bucketing.
 *
 *              All money math goes through `toMinor` / `fromMinor` from
 *              `@/lib/utils/currency` so we never accumulate floating-point
 *              drift. Inputs come straight from Prisma rows (Decimal serialises
 *              to a string at the JS boundary; we accept either for ergonomics).
 *
 *              Multi-currency strategy for v1: bucket by currency code. We do
 *              NOT convert between currencies — the dashboard renders one
 *              card per currency the user actually uses, and converts only
 *              when the user explicitly requests it (a future feature).
 */

import { fromMinor, toMinor } from '@/lib/utils/currency';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Subset shape used by the aggregation helpers. `amount` accepts a Prisma
 * Decimal (which is just an object with `toString()`), a decimal string, or
 * a number — anything `decimalString()` knows how to handle. Letting the
 * type be permissive here keeps Prisma Decimal rows AND test fixtures with
 * literal strings type-compatible without a cast at the call site.
 */
export interface TransactionSubset {
  amount: string | number | { toString(): string };
  currency: string;
  type: 'INCOME' | 'EXPENSE';
  category: string | null;
  occurredAt: Date;
}

/** Income/expense/net for a single currency bucket, as decimal strings. */
export interface PLBucket {
  currency: string;
  income: string;
  expense: string;
  net: string;
}

/** Sum of a single category's expenses, plus its share of the currency total. */
export interface CategoryBucket {
  category: string;
  total: string;
  share: number; // 0 to 1
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Coerce a Prisma `Decimal | string | number` into a decimal string with up
 * to two fractional digits. Defensive — Prisma's runtime returns Decimal
 * objects but JSON/RSC serialisation passes strings.
 */
function decimalString(amount: unknown): string {
  if (typeof amount === 'string') return amount;
  if (typeof amount === 'number') return amount.toFixed(2);
  // Prisma Decimal has a toString() method.
  if (amount && typeof amount === 'object' && 'toString' in amount) {
    return (amount as { toString(): string }).toString();
  }
  throw new Error(`decimalString: unsupported amount value (type=${typeof amount})`);
}

// ---------------------------------------------------------------------------
// P&L summary
// ---------------------------------------------------------------------------

/**
 * Summarise a list of transactions into one bucket per currency.
 * Order of buckets in the output mirrors first-occurrence order in `txs`,
 * giving stable output for tests.
 *
 * @param txs - Transactions for the period under review.
 * @returns One {@link PLBucket} per distinct currency.
 *
 * @example
 *   const summary = summarise(transactions);
 *   summary[0]; // { currency: 'USD', income: '12000.00', expense: '4500.00', net: '7500.00' }
 */
export function summarise(txs: readonly TransactionSubset[]): PLBucket[] {
  const incomeByCcy = new Map<string, bigint>();
  const expenseByCcy = new Map<string, bigint>();
  const order: string[] = [];

  for (const tx of txs) {
    const minor = toMinor(decimalString(tx.amount));
    if (!incomeByCcy.has(tx.currency)) {
      incomeByCcy.set(tx.currency, 0n);
      expenseByCcy.set(tx.currency, 0n);
      order.push(tx.currency);
    }
    if (tx.type === 'INCOME') {
      incomeByCcy.set(tx.currency, incomeByCcy.get(tx.currency)! + minor);
    } else {
      expenseByCcy.set(tx.currency, expenseByCcy.get(tx.currency)! + minor);
    }
  }

  return order.map((currency) => {
    const income = incomeByCcy.get(currency)!;
    const expense = expenseByCcy.get(currency)!;
    return {
      currency,
      income: fromMinor(income),
      expense: fromMinor(expense),
      net: fromMinor(income - expense),
    };
  });
}

// ---------------------------------------------------------------------------
// Category breakdown
// ---------------------------------------------------------------------------

/**
 * Group expense transactions by category and return per-category totals
 * sorted descending by amount. Useful for the "Where is my money going?"
 * card on the Financial OS dashboard.
 *
 * @param txs - Transactions filtered to a single currency for accurate share math.
 * @returns Array of CategoryBucket entries, descending by total.
 */
export function expenseByCategory(txs: readonly TransactionSubset[]): CategoryBucket[] {
  const totals = new Map<string, bigint>();
  let grandTotal = 0n;

  for (const tx of txs) {
    if (tx.type !== 'EXPENSE') continue;
    const cat = tx.category ?? 'uncategorised';
    const minor = toMinor(decimalString(tx.amount));
    totals.set(cat, (totals.get(cat) ?? 0n) + minor);
    grandTotal += minor;
  }

  if (grandTotal === 0n) return [];

  const entries = Array.from(totals.entries())
    .map(([category, total]): CategoryBucket => ({
      category,
      total: fromMinor(total),
      share: Number(total) / Number(grandTotal),
    }))
    .sort((a, b) => Number(toMinor(b.total) - toMinor(a.total)));

  return entries;
}

// ---------------------------------------------------------------------------
// Annual estimation (used by the tax module)
// ---------------------------------------------------------------------------

/**
 * Annualise the year-to-date net profit. Treats the partial year linearly,
 * which is a reasonable rule-of-thumb for solo freelancers with smooth
 * cashflow. Returns 0 for zero or negative YTD net.
 *
 * @param ytdNet - Year-to-date net (income - expense) as decimal string.
 * @param now    - Current date. Defaulted to `new Date()` so tests can pin it.
 * @returns Estimated annual net (decimal string), never negative.
 */
export function projectAnnualNet(ytdNet: string, now: Date = new Date()): string {
  const ytdMinor = toMinor(ytdNet);
  if (ytdMinor <= 0n) return '0.00';

  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const elapsedMs = now.getTime() - start.getTime();
  const yearMs = 365 * 24 * 60 * 60 * 1000;
  const fraction = Math.max(elapsedMs / yearMs, 1 / 365); // floor at one day

  // Multiply minor units by (1/fraction). Convert via Number — money is
  // bounded by a 12,2 Decimal so Number's 53-bit mantissa is plenty.
  const projected = BigInt(Math.round(Number(ytdMinor) / fraction));
  return fromMinor(projected);
}
