/**
 * @file lib/finances/tax/index.ts
 * @description Dispatcher for the per-jurisdiction tax estimators. Resolves
 *              the correct estimator from a {@link Jurisdiction} value and
 *              forwards the call. Throws when the jurisdiction has no
 *              estimator yet — every Prisma enum value MUST be wired here.
 */

import type { Jurisdiction } from '@prisma/client';

import { estimateTaxCA } from './ca';
import { estimateTaxUK } from './uk';
import { estimateTaxUS } from './us';
import type { TaxEstimateInput, TaxEstimateResult } from './types';

export type { TaxEstimateInput, TaxEstimateResult };

/**
 * Default ISO-4217 currency per jurisdiction. Used to populate the input
 * for users who haven't explicitly chosen a transaction currency yet.
 */
export const TAX_DEFAULT_CURRENCY: Record<Jurisdiction, string> = {
  US: 'USD',
  CA: 'CAD',
  UK: 'GBP',
};

/**
 * Run the estimator for the user's jurisdiction.
 *
 * @param jurisdiction - User.jurisdiction.
 * @param input        - Annual net income + currency.
 * @returns TaxEstimateResult.
 * @throws Error when the input currency does not match the jurisdiction's
 *         expected currency (callers should pre-bucket / convert before invoking).
 */
export function estimateTaxFor(
  jurisdiction: Jurisdiction,
  input: TaxEstimateInput,
): TaxEstimateResult {
  switch (jurisdiction) {
    case 'US':
      return estimateTaxUS(input);
    case 'CA':
      return estimateTaxCA(input);
    case 'UK':
      return estimateTaxUK(input);
    default: {
      // Exhaustiveness check — TypeScript will flag a missing case at compile time.
      const _exhaustive: never = jurisdiction;
      throw new Error(`No tax estimator for jurisdiction: ${String(_exhaustive)}`);
    }
  }
}
