/**
 * @file lib/finances/tax/ca.ts
 * @description Canadian tax estimator for a self-employed sole proprietor
 *              filing federally + Ontario provincial. Computes:
 *                1. CPP contributions (both employer + employee halves —
 *                   self-employed pay both) on net business income above
 *                   the basic exemption, capped at YMPE.
 *                2. Federal income tax — 2024 progressive brackets after
 *                   the basic personal amount.
 *                3. Ontario provincial tax — 2024 progressive brackets.
 *                4. Quarterly = annual / 4 (CRA installments are due Mar 15,
 *                   Jun 15, Sep 15, Dec 15).
 *
 *              Provincial choice: defaults to Ontario as the most populous
 *              province. A future iteration can accept a `province` parameter
 *              and dispatch to per-province bracket tables.
 *
 *              EI premiums are not included — self-employed Canadians can
 *              opt-in to EI but most don't.
 */

import { applyBrackets, type BracketStep, type TaxEstimateInput, type TaxEstimateResult } from './types';

// ---------------------------------------------------------------------------
// Constants — TY 2024
// ---------------------------------------------------------------------------

/** Federal Basic Personal Amount (TY 2024) — income below this is untaxed federally. */
const BPA_FEDERAL_2024 = 15_705;
/** Ontario Basic Personal Amount (TY 2024). */
const BPA_ONTARIO_2024 = 12_399;

/** CPP year's maximum pensionable earnings (YMPE 2024). */
const CPP_YMPE_2024 = 68_500;
/** CPP basic exemption (no contributions on first $3,500). */
const CPP_BASIC_EXEMPTION = 3_500;
/** Self-employed pay 11.9% (2× the 5.95% employee rate) up to YMPE. */
const CPP_RATE_SELF_EMPLOYED = 0.119;

/** Federal brackets (TY 2024). */
const FEDERAL_BRACKETS_2024: readonly BracketStep[] = [
  { upTo: 55_867, rate: 0.15 },
  { upTo: 111_733, rate: 0.205 },
  { upTo: 173_205, rate: 0.26 },
  { upTo: 246_752, rate: 0.29 },
  { upTo: null, rate: 0.33 },
];

/** Ontario provincial brackets (TY 2024). Ontario surtax is folded in
 *  approximately by using slightly elevated effective rates above $98k —
 *  for a back-of-envelope estimator this is honest enough. */
const ONTARIO_BRACKETS_2024: readonly BracketStep[] = [
  { upTo: 51_446, rate: 0.0505 },
  { upTo: 102_894, rate: 0.0915 },
  { upTo: 150_000, rate: 0.1116 },
  { upTo: 220_000, rate: 0.1216 },
  { upTo: null, rate: 0.1316 },
];

// ---------------------------------------------------------------------------
// CPP
// ---------------------------------------------------------------------------

export function cppContributions(netIncome: number): number {
  const pensionable = Math.max(0, Math.min(netIncome, CPP_YMPE_2024) - CPP_BASIC_EXEMPTION);
  return pensionable * CPP_RATE_SELF_EMPLOYED;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Estimate Canadian (federal + Ontario) tax for a self-employed sole proprietor.
 *
 * @param input - Annual net business income; currency MUST be CAD.
 * @returns Itemised estimate.
 */
export function estimateTaxCA(input: TaxEstimateInput): TaxEstimateResult {
  if (input.currency !== 'CAD') {
    throw new Error(`estimateTaxCA expects CAD; got ${input.currency}`);
  }

  const netIncome = Math.max(0, Number(input.annualNetIncome));
  const cpp = cppContributions(netIncome);

  // Half of CPP is deductible against income for federal+provincial tax.
  const cppDeduction = cpp / 2;
  const taxableFederal = Math.max(0, netIncome - cppDeduction - BPA_FEDERAL_2024);
  const taxableOntario = Math.max(0, netIncome - cppDeduction - BPA_ONTARIO_2024);

  const federalTax = Number(applyBrackets(taxableFederal.toFixed(2), FEDERAL_BRACKETS_2024));
  const ontarioTax = Number(applyBrackets(taxableOntario.toFixed(2), ONTARIO_BRACKETS_2024));

  const annualTotal = cpp + federalTax + ontarioTax;
  const quarterly = annualTotal / 4;
  const effectiveRate = netIncome > 0 ? annualTotal / netIncome : 0;

  return {
    jurisdiction: 'CA',
    currency: 'CAD',
    annualNetIncome: netIncome.toFixed(2),
    estimatedAnnualTax: annualTotal.toFixed(2),
    estimatedQuarterly: quarterly.toFixed(2),
    effectiveRate: Number(effectiveRate.toFixed(4)),
    lineItems: [
      {
        label: 'CPP contributions (self-employed)',
        amount: cpp.toFixed(2),
        description: '11.9% on pensionable earnings above $3,500 up to YMPE ($68,500).',
      },
      {
        label: 'Federal income tax',
        amount: federalTax.toFixed(2),
        description: `2024 federal brackets after $${BPA_FEDERAL_2024.toLocaleString()} BPA and ½ CPP deduction.`,
      },
      {
        label: 'Ontario provincial tax',
        amount: ontarioTax.toFixed(2),
        description: `Approximate Ontario brackets (incl. surtax effective rate) after BPA $${BPA_ONTARIO_2024.toLocaleString()}.`,
      },
    ],
    notes: [
      'Estimate only — assumes Ontario residency. Other provinces use different rates.',
      'Excludes voluntary EI premiums.',
      'CRA installment due dates: Mar 15, Jun 15, Sep 15, Dec 15.',
      'Tax-year constants pinned to 2024.',
    ],
  };
}
