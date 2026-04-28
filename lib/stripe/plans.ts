/**
 * @file lib/stripe/plans.ts
 * @description Subscription tier definitions: price ID, feature limits, and
 *              the helper used by the PlanGate component.
 *
 *              When adding a new plan:
 *                1. Add a row to PLANS below.
 *                2. Add the price ID to .env.example.
 *                3. Update docs/RUNBOOK.md (Stripe configuration section).
 *                4. Add an enum value in prisma/schema.prisma if needed and
 *                   create a migration.
 */

import type { PlanTier } from '@prisma/client';

/** Capabilities granted by a plan. Treat Infinity as "no limit". */
export interface PlanLimits {
  /** Max ACTIVE projects the user can have at once. */
  activeProjects: number;
  /** Max scope checks per calendar month. */
  scopeChecksPerMonth: number;
  /** Whether the Financial OS module is unlocked. */
  hasFinancialOS: boolean;
  /** Whether one-click CPA-export PDF is unlocked. */
  hasCPAExport: boolean;
}

/** Single plan definition. */
export interface PlanConfig {
  /** Stripe price ID. Lazily read from env so tests don't crash. */
  readonly priceId: string | undefined;
  /** Database tier value. */
  readonly tier: PlanTier;
  /** What the plan unlocks. */
  readonly limits: PlanLimits;
  /** Display name for marketing pages and the billing UI. */
  readonly displayName: string;
  /** Monthly price in major units. Display only; Stripe is the source of truth. */
  readonly displayPriceUsd: number | null;
}

/**
 * The full plan catalogue. `priceId` is read at access time so SSG builds
 * without env vars don't crash.
 */
export const PLANS: Record<Exclude<PlanTier, 'FREE'>, PlanConfig> = {
  STARTER: {
    get priceId() {
      return process.env['STRIPE_STARTER_PRICE_ID'];
    },
    tier: 'STARTER',
    displayName: 'Starter',
    displayPriceUsd: 19,
    limits: {
      activeProjects: 3,
      scopeChecksPerMonth: 100,
      hasFinancialOS: false,
      hasCPAExport: false,
    },
  },
  PRO: {
    get priceId() {
      return process.env['STRIPE_PRO_PRICE_ID'];
    },
    tier: 'PRO',
    displayName: 'Pro',
    displayPriceUsd: 39,
    limits: {
      activeProjects: Infinity,
      scopeChecksPerMonth: Infinity,
      hasFinancialOS: true,
      hasCPAExport: false,
    },
  },
  BUSINESS: {
    get priceId() {
      return process.env['STRIPE_BUSINESS_PRICE_ID'];
    },
    tier: 'BUSINESS',
    displayName: 'Business',
    displayPriceUsd: 69,
    limits: {
      activeProjects: Infinity,
      scopeChecksPerMonth: Infinity,
      hasFinancialOS: true,
      hasCPAExport: true,
    },
  },
} as const;

/** Limits applied when the user has no active subscription. */
export const FREE_LIMITS: PlanLimits = {
  activeProjects: 1,
  scopeChecksPerMonth: 5,
  hasFinancialOS: false,
  hasCPAExport: false,
} as const;

/**
 * Resolve the limits for a given tier.
 *
 * @param tier - PlanTier from User.planTier.
 * @returns The capability limits for that tier.
 *
 * @example
 *   const limits = getPlanLimits(user.planTier);
 *   if (!limits.hasFinancialOS) return <PlanGate tier="PRO" />;
 */
export function getPlanLimits(tier: PlanTier): PlanLimits {
  if (tier === 'FREE') return FREE_LIMITS;
  return PLANS[tier].limits;
}

/**
 * Reverse-lookup a tier from a Stripe price ID. Used by the
 * checkout.session.completed webhook handler.
 *
 * @param priceId - Stripe price ID from the subscription line item.
 * @returns PlanTier or null when the priceId is unknown.
 */
export function tierFromPriceId(priceId: string): PlanTier | null {
  for (const plan of Object.values(PLANS)) {
    if (plan.priceId === priceId) return plan.tier;
  }
  return null;
}
