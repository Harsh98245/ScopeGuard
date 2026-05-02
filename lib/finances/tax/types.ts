/**
 * @file lib/finances/tax/types.ts
 * @description Shared types across the per-jurisdiction tax estimators.
 *              Each jurisdiction module exports an `estimateTax(input)`
 *              function whose return type matches {@link TaxEstimateResult}.
 *
 *              These estimators are GUIDANCE, not tax advice. The README
 *              and UI surface this disclaimer prominently.
 */

import type { Jurisdiction } from '@prisma/client';

/** Inputs every jurisdictional estimator accepts. */
export interface TaxEstimateInput {
  /** Projected annual NET self-employment income (gross income minus deductible expenses). */
  annualNetIncome: string;
  /** ISO 4217 currency code the figures are expressed in. Estimators expect their native currency. */
  currency: string;
  /** Optional projected annual GROSS income, used by some calculators (UK class 4 NICs). */
  annualGrossIncome?: string;
}

/** A single named line item inside the breakdown (e.g. "Federal income tax", "Self-employment tax"). */
export interface TaxLineItem {
  label: string;
  amount: string;
  /** Optional explanatory text shown next to the figure. */
  description?: string;
}

/** Output of every jurisdictional estimator. */
export interface TaxEstimateResult {
  jurisdiction: Jurisdiction;
  currency: string;
  annualNetIncome: string;
  /** Total estimated tax due for the year (sum of `lineItems[].amount`). */
  estimatedAnnualTax: string;
  /** Suggested per-quarter set-aside (annualTax / 4). */
  estimatedQuarterly: string;
  /** Effective rate (estimatedAnnualTax / annualNetIncome). 0–1. */
  effectiveRate: number;
  /** Itemised breakdown — useful for the UI to explain the figure. */
  lineItems: TaxLineItem[];
  /** Free-form notes ("Assumes single filer", etc). */
  notes: string[];
}

/** A progressive bracket step. `upTo: null` means "and above". */
export interface BracketStep {
  upTo: number | null;
  rate: number;
}

/**
 * Apply a progressive bracket to an income amount and return the tax due.
 * Inputs and output are decimal strings handled at the major-unit level via
 * `Number` — money is bounded to 12.2 decimal so 53-bit mantissa is fine.
 *
 * @param income  - Income to tax (decimal string).
 * @param brackets - Sorted ascending bracket schedule.
 * @returns Tax due (decimal string with 2 fractional digits).
 *
 * @example
 *   applyBrackets('50000', [
 *     { upTo: 10000, rate: 0.10 },
 *     { upTo: 40000, rate: 0.20 },
 *     { upTo: null, rate: 0.30 },
 *   ]); // = (10000*0.10) + (30000*0.20) + (10000*0.30) = 1000 + 6000 + 3000 = "10000.00"
 */
export function applyBrackets(income: string, brackets: readonly BracketStep[]): string {
  const remaining = Math.max(Number(income), 0);
  let owed = 0;
  let lastCap = 0;
  for (const step of brackets) {
    const cap = step.upTo ?? Number.POSITIVE_INFINITY;
    const slice = Math.max(0, Math.min(remaining, cap) - lastCap);
    owed += slice * step.rate;
    lastCap = cap;
    if (remaining <= cap) break;
  }
  return owed.toFixed(2);
}
