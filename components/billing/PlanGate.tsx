/**
 * @file components/billing/PlanGate.tsx
 * @description Server-component wrapper that conditionally renders a feature
 *              based on the user's current plan tier. When the user does not
 *              have access, an upgrade CTA card is rendered in place of the
 *              gated content.
 *
 *              Tier ordering (cheapest → most expensive):
 *                FREE < STARTER < PRO < BUSINESS
 *
 *              Pass `requires` as the minimum tier needed; users on that tier
 *              or higher see `children`. Lower-tier users see the upgrade CTA.
 *
 * @example
 *   // Lock the Financial OS dashboard behind PRO.
 *   <PlanGate
 *     requires="PRO"
 *     currentTier={user.planTier}
 *     featureName="Financial OS"
 *     featureDescription="Unified P&L, expense AI categorisation, and tax estimates."
 *   >
 *     <FinancialDashboard />
 *   </PlanGate>
 */

import Link from 'next/link';
import type { PlanTier } from '@prisma/client';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PLANS } from '@/lib/stripe/plans';

// ---------------------------------------------------------------------------
// Tier ordering
// ---------------------------------------------------------------------------

const TIER_RANK: Record<PlanTier, number> = {
  FREE: 0,
  STARTER: 1,
  PRO: 2,
  BUSINESS: 3,
};

/**
 * Predicate: does `tier` satisfy `required`?
 * Returns true when the user's tier rank is at least the required rank.
 */
export function tierSatisfies(tier: PlanTier, required: PlanTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[required];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PlanGateProps {
  /** Minimum plan tier required to access the feature. */
  requires: Exclude<PlanTier, 'FREE'>;
  /** The user's current plan tier (typically `user.planTier`). */
  currentTier: PlanTier;
  /** Display name of the gated feature, used in the upgrade card title. */
  featureName: string;
  /** Single-sentence description of the feature shown in the upgrade card. */
  featureDescription: string;
  /** Feature content rendered when the user has access. */
  children: ReactNode;
  /** Optional override for the upgrade CTA shown when access is denied. */
  fallback?: ReactNode;
}

export function PlanGate({
  requires,
  currentTier,
  featureName,
  featureDescription,
  children,
  fallback,
}: PlanGateProps) {
  if (tierSatisfies(currentTier, requires)) {
    return <>{children}</>;
  }

  if (fallback !== undefined) return <>{fallback}</>;

  const requiredPlan = PLANS[requires];

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {featureName}
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-secondary-foreground">
            {requiredPlan.displayName}
          </span>
        </CardTitle>
        <CardDescription>{featureDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Upgrade to <span className="font-medium text-foreground">{requiredPlan.displayName}</span>
          {requiredPlan.displayPriceUsd !== null
            ? ` ($${requiredPlan.displayPriceUsd}/month)`
            : ''}{' '}
          to unlock this feature.
        </p>
        <Button asChild>
          <Link href="/settings/billing">View plans →</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
