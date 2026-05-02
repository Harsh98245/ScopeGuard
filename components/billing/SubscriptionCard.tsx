/**
 * @file components/billing/SubscriptionCard.tsx
 * @description Server component that surfaces the user's current subscription
 *              state and provides two CTAs: "Manage subscription" (Stripe
 *              Customer Portal) and "Upgrade" (when on FREE).
 *
 *              The Manage button is a tiny client island so we can show a
 *              loading state during the portal-session creation round-trip.
 */

import type { PlanTier } from '@prisma/client';

import { ManageSubscriptionButton } from '@/components/billing/ManageSubscriptionButton';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PLANS } from '@/lib/stripe/plans';

interface SubscriptionCardProps {
  user: {
    planTier: PlanTier;
    subscriptionStatus: string | null;
    currentPeriodEnd: Date | null;
    stripeCustomerId: string | null;
  };
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'success'> = {
  active: 'success',
  trialing: 'success',
  past_due: 'destructive',
  unpaid: 'destructive',
  canceled: 'secondary',
  incomplete: 'secondary',
  incomplete_expired: 'secondary',
  paused: 'secondary',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  trialing: 'Trial',
  past_due: 'Past due',
  unpaid: 'Unpaid',
  canceled: 'Cancelled',
  incomplete: 'Incomplete',
  incomplete_expired: 'Expired',
  paused: 'Paused',
};

export function SubscriptionCard({ user }: SubscriptionCardProps) {
  const isPaid = user.planTier !== 'FREE';
  const planDisplayName =
    user.planTier === 'FREE' ? 'Free' : PLANS[user.planTier].displayName;

  const status = user.subscriptionStatus ?? null;
  const statusVariant = status ? STATUS_VARIANT[status] ?? 'secondary' : 'secondary';
  const statusLabel = status ? STATUS_LABEL[status] ?? status : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-lg">Current plan</CardTitle>
          <Badge variant="outline" className="font-semibold uppercase">
            {planDisplayName}
          </Badge>
          {statusLabel && (
            <Badge variant={statusVariant}>{statusLabel}</Badge>
          )}
        </div>
        <CardDescription>
          {!isPaid && 'Upgrade to unlock more projects, scope checks, and the Financial OS.'}
          {isPaid &&
            user.currentPeriodEnd &&
            (status === 'canceled'
              ? `Access ends ${formatDate(user.currentPeriodEnd)}.`
              : `Renews ${formatDate(user.currentPeriodEnd)}.`)}
          {isPaid && !user.currentPeriodEnd && 'Subscription details unavailable.'}
        </CardDescription>
      </CardHeader>

      {isPaid && user.stripeCustomerId && (
        <CardContent>
          <ManageSubscriptionButton />
        </CardContent>
      )}
    </Card>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
