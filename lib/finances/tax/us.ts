/**
 * @file lib/finances/tax/us.ts
 * @description US federal tax estimator for solo freelancers / sole
 *              proprietors filing as single. Computes:
 *                1. Self-employment (SE) tax — 15.3% on 92.35% of net SE income,
 *                   with the Social Security portion capped at the wage base.
 *                2. Federal income tax — progressive 2024 single-filer brackets
 *                   applied to (net SE income − ½ SE tax − standard deduction).
 *                3. Quarterly estimate — annual total divided by 4.
 *
 *              State income tax is intentionally NOT modelled — it varies
 *              wildly by state and the user must layer their own state estimate.
 *              The UI shows a banner reminding them.
 *
 *              Bracket schedule and constants are pinned to TY 2024. Update
 *              the constants at the top of this file when bumping to a new
 *              tax year — the structure of the math doesn't change.
 */

import { applyBrackets, type BracketStep, type TaxEstimateInput, type TaxEstimateResult } from './types';

// ---------------------------------------------------------------------------
// Constants — TY 2024 single filer
// ---------------------------------------------------------------------------

/** Standard deduction for a single filer (TY 2024). */
const STANDARD_DEDUCTION_2024 = 14_600;

/** Social Security wage base (TY 2024). The 12.4% SS half of SE tax stops here. */
const SS_WAGE_BASE_2024 = 168_600;

/** SE tax: 12.4% Social Security + 2.9% Medicare = 15.3% of net SE earnings ×0.9235. */
const SE_TAX_SS_RATE = 0.124;
const SE_TAX_MEDICARE_RATE = 0.029;
const SE_NET_EARNINGS_FACTOR = 0.9235;

/** Federal income brackets — 2024 single filer (https://www.irs.gov/forms-pubs/about-publication-17). */
const FEDERAL_BRACKETS_2024_SINGLE: readonly BracketStep[] = [
  { upTo: 11_600, rate: 0.1 },
  { upTo: 47_150, rate: 0.12 },
  { upTo: 100_525, rate: 0.22 },
  { upTo: 191_950, rate: 0.24 },
  { upTo: 243_725, rate: 0.32 },
  { upTo: 609_350, rate: 0.35 },
  { upTo: null, rate: 0.37 },
];

// ---------------------------------------------------------------------------
// SE tax
// ---------------------------------------------------------------------------

/**
 * Compute self-employment tax on net SE income.
 * Formula: 0.9235 × netSE → split into SS (12.4%, capped at wage base) + Medicare (2.9%, uncapped).
 */
export function selfEmploymentTax(netSeIncome: number): number {
  const taxable = Math.max(0, netSeIncome) * SE_NET_EARNINGS_FACTOR;
  const ssTaxable = Math.min(taxable, SS_WAGE_BASE_2024);
  const ssTax = ssTaxable * SE_TAX_SS_RATE;
  const medicareTax = taxable * SE_TAX_MEDICARE_RATE;
  return ssTax + medicareTax;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Estimate US federal tax for a solo freelancer based on annual net income.
 * Output is a {@link TaxEstimateResult} with:
 *   - Two line items: SE tax + federal income tax.
 *   - Quarterly = annual / 4.
 *   - A note reminding the user this excludes state tax.
 *
 * @param input - Annual net SE income (decimal string), currency MUST be USD.
 * @returns Estimate with itemised breakdown.
 */
export function estimateTaxUS(input: TaxEstimateInput): TaxEstimateResult {
  if (input.currency !== 'USD') {
    throw new Error(`estimateTaxUS expects USD; got ${input.currency}`);
  }

  const netSe = Math.max(0, Number(input.annualNetIncome));
  const seTax = selfEmploymentTax(netSe);

  // Federal income tax base: net SE − half of SE tax − standard deduction.
  const halfSeDeduction = seTax / 2;
  const taxableIncome = Math.max(0, netSe - halfSeDeduction - STANDARD_DEDUCTION_2024);

  const incomeTaxStr = applyBrackets(taxableIncome.toFixed(2), FEDERAL_BRACKETS_2024_SINGLE);
  const incomeTax = Number(incomeTaxStr);

  const annualTotal = seTax + incomeTax;
  const quarterly = annualTotal / 4;
  const effectiveRate = netSe > 0 ? annualTotal / netSe : 0;

  return {
    jurisdiction: 'US',
    currency: 'USD',
    annualNetIncome: netSe.toFixed(2),
    estimatedAnnualTax: annualTotal.toFixed(2),
    estimatedQuarterly: quarterly.toFixed(2),
    effectiveRate: Number(effectiveRate.toFixed(4)),
    lineItems: [
      {
        label: 'Self-employment tax',
        amount: seTax.toFixed(2),
        description: '15.3% on 92.35% of net SE income (Social Security capped at wage base).',
      },
      {
        label: 'Federal income tax',
        amount: incomeTax.toFixed(2),
        description: `2024 single-filer brackets after $${STANDARD_DEDUCTION_2024.toLocaleString()} standard deduction and ½ SE tax.`,
      },
    ],
    notes: [
      'Estimate only — does NOT include state income tax. Add your state liability separately.',
      'Assumes single filer with no other income or itemised deductions.',
      'Quarterly figure = annual ÷ 4. Use IRS Form 1040-ES vouchers for actual payments.',
      'Tax-year constants pinned to 2024 — update when filing for a future year.',
    ],
  };
}
