/**
 * @file lib/finances/tax/uk.ts
 * @description UK tax estimator for a sole trader filing Self-Assessment for
 *              the 2024-25 tax year. Computes:
 *                1. Class 4 NICs — 6% on profits between Lower Profits Limit
 *                   (£12,570) and Upper Profits Limit (£50,270), then 2% above.
 *                2. Income tax — progressive bands after the personal allowance.
 *                   Personal allowance tapers above £100k earnings; for v1 we
 *                   apply the full taper as a flat reduction (worst-case from
 *                   the user's perspective so the set-aside is conservative).
 *                3. Quarterly = annual / 4 (NB: actual UK Self-Assessment
 *                   payments are due Jan 31 + Jul 31 — the dashboard exposes
 *                   the quarterly figure as a saving target, not a payment date).
 *
 *              Class 2 NICs were abolished for most sole traders from 2024-25,
 *              so the calculator omits them.
 *
 *              Scotland has its own income tax bands and is NOT modelled — the
 *              UI surfaces a banner reminding Scottish users to adjust.
 */

import { applyBrackets, type BracketStep, type TaxEstimateInput, type TaxEstimateResult } from './types';

// ---------------------------------------------------------------------------
// Constants — TY 2024-25 (rUK, excluding Scotland)
// ---------------------------------------------------------------------------

/** Personal allowance (TY 2024-25). Income below this is untaxed. */
const PERSONAL_ALLOWANCE_2024_25 = 12_570;

/** Personal allowance tapers above this gross income, £1 lost per £2 over. */
const PA_TAPER_THRESHOLD = 100_000;

/** Income tax bands applied to (income − allowance). Sorted ascending. */
const INCOME_TAX_BANDS_2024_25: readonly BracketStep[] = [
  { upTo: 37_700, rate: 0.2 }, // Basic rate band (0–37,700 over allowance)
  { upTo: 125_140 - PERSONAL_ALLOWANCE_2024_25, rate: 0.4 }, // Higher rate
  { upTo: null, rate: 0.45 }, // Additional rate
];

/** Class 4 NIC bands (TY 2024-25). */
const CLASS_4_LOWER_LIMIT = 12_570;
const CLASS_4_UPPER_LIMIT = 50_270;
const CLASS_4_MAIN_RATE = 0.06;
const CLASS_4_UPPER_RATE = 0.02;

// ---------------------------------------------------------------------------
// Calculations
// ---------------------------------------------------------------------------

export function class4Nics(profits: number): number {
  const p = Math.max(0, profits);
  const main = Math.max(0, Math.min(p, CLASS_4_UPPER_LIMIT) - CLASS_4_LOWER_LIMIT);
  const upper = Math.max(0, p - CLASS_4_UPPER_LIMIT);
  return main * CLASS_4_MAIN_RATE + upper * CLASS_4_UPPER_RATE;
}

/** Taper the personal allowance for high earners. */
export function taperedAllowance(grossIncome: number): number {
  if (grossIncome <= PA_TAPER_THRESHOLD) return PERSONAL_ALLOWANCE_2024_25;
  const reduction = Math.min(PERSONAL_ALLOWANCE_2024_25, (grossIncome - PA_TAPER_THRESHOLD) / 2);
  return Math.max(0, PERSONAL_ALLOWANCE_2024_25 - reduction);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Estimate UK tax for a sole trader (rUK — Scotland not modelled).
 *
 * @param input - Annual net profit; currency MUST be GBP. `annualGrossIncome`
 *                is used for the personal-allowance taper if provided.
 * @returns Itemised estimate.
 */
export function estimateTaxUK(input: TaxEstimateInput): TaxEstimateResult {
  if (input.currency !== 'GBP') {
    throw new Error(`estimateTaxUK expects GBP; got ${input.currency}`);
  }

  const profit = Math.max(0, Number(input.annualNetIncome));
  const gross = input.annualGrossIncome
    ? Math.max(0, Number(input.annualGrossIncome))
    : profit;

  const allowance = taperedAllowance(gross);
  const taxableIncome = Math.max(0, profit - allowance);

  const incomeTax = Number(applyBrackets(taxableIncome.toFixed(2), INCOME_TAX_BANDS_2024_25));
  const nics = class4Nics(profit);

  const annualTotal = incomeTax + nics;
  const quarterly = annualTotal / 4;
  const effectiveRate = profit > 0 ? annualTotal / profit : 0;

  return {
    jurisdiction: 'UK',
    currency: 'GBP',
    annualNetIncome: profit.toFixed(2),
    estimatedAnnualTax: annualTotal.toFixed(2),
    estimatedQuarterly: quarterly.toFixed(2),
    effectiveRate: Number(effectiveRate.toFixed(4)),
    lineItems: [
      {
        label: 'Income tax',
        amount: incomeTax.toFixed(2),
        description: `Bands applied after a £${allowance.toLocaleString()} personal allowance.`,
      },
      {
        label: 'Class 4 NICs',
        amount: nics.toFixed(2),
        description: '6% on profits £12,570–£50,270, then 2% above. Class 2 abolished from 2024-25.',
      },
    ],
    notes: [
      'Estimate for England, Wales, and Northern Ireland. Scotland uses different income tax bands.',
      'Self-Assessment due dates: Jan 31 (balancing payment + first installment) and Jul 31 (second installment).',
      'Quarterly figure is a saving target only; not an HMRC payment schedule.',
      'Tax-year constants pinned to 2024-25.',
    ],
  };
}
