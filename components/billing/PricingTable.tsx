/**
 * @file components/billing/PricingTable.tsx
 * @description Renders the three paid plan tiers as side-by-side pricing
 *              cards. Each card has a server-action-like form that POSTs to
 *              /api/billing/checkout with the target tier; the route returns
 *              the Stripe Checkout URL and the client island redirects.
 *
 *              The card matching the user's current tier is highlighted and
 *              its CTA is disabled.
 */

import type { PlanTier } from '@prisma/client';

import { CheckoutButton } from '@/components/billing/CheckoutButton';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils/cn';
import { PLANS } from '@/lib/stripe/plans';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PricingTableProps {
  /** Current plan tier of the signed-in user. */
  currentTier: PlanTier;
}

// ---------------------------------------------------------------------------
// Tier order — cheapest first
// ---------------------------------------------------------------------------

const PAID_TIER_ORDER = ['STARTER', 'PRO', 'BUSINESS'] as const satisfies ReadonlyArray<
  Exclude<PlanTier, 'FREE'>
>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PricingTable({ currentTier }: PricingTableProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {PAID_TIER_ORDER.map((tier) => {
        const plan = PLANS[tier];
        const isCurrent = currentTier === tier;
        const isPopular = tier === 'PRO';

        return (
          <Card
            key={tier}
            className={cn(
              'flex flex-col',
              isPopular && 'border-primary',
              isCurrent && 'ring-2 ring-primary',
            )}
          >
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{plan.displayName}</CardTitle>
                {isPopular && !isCurrent && (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground">
                    Popular
                  </span>
                )}
                {isCurrent && (
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-secondary-foreground">
                    Current
                  </span>
                )}
              </div>
              <CardDescription>
                {plan.displayPriceUsd !== null ? (
                  <>
                    <span className="text-2xl font-bold text-foreground">
                      ${plan.displayPriceUsd}
                    </span>
                    <span className="text-sm">/month</span>
                  </>
                ) : (
                  'Contact us'
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 space-y-4">
              <ul className="space-y-2 text-sm">
                <FeatureLine
                  text={
                    plan.limits.activeProjects === Infinity
                      ? 'Unlimited active projects'
                      : `${plan.limits.activeProjects} active projects`
                  }
                />
                <FeatureLine
                  text={
                    plan.limits.scopeChecksPerMonth === Infinity
                      ? 'Unlimited scope checks'
                      : `${plan.limits.scopeChecksPerMonth} scope checks / month`
                  }
                />
                <FeatureLine text="AI verdicts with cited clauses" />
                <FeatureLine text="Drafted change orders" />
                <FeatureLine
                  text="Financial OS module"
                  enabled={plan.limits.hasFinancialOS}
                />
                <FeatureLine
                  text="One-click CPA export"
                  enabled={plan.limits.hasCPAExport}
                />
              </ul>

              <CheckoutButton tier={tier} disabled={isCurrent} />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component
// ---------------------------------------------------------------------------

function FeatureLine({ text, enabled = true }: { text: string; enabled?: boolean }) {
  return (
    <li className={cn('flex items-start gap-2', !enabled && 'text-muted-foreground line-through')}>
      <span aria-hidden className="mt-0.5">
        {enabled ? '✓' : '–'}
      </span>
      <span>{text}</span>
    </li>
  );
}
