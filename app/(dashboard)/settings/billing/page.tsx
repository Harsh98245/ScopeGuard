/**
 * @file app/(dashboard)/settings/billing/page.tsx
 * @description Billing & plans page. Shows the user's current subscription,
 *              renewal date, manage button (Stripe Customer Portal), and the
 *              full pricing table for upgrades/downgrades.
 *
 *              Banners show transient state from a Stripe Checkout return:
 *                ?checkout=success   → "Subscription started"
 *                ?checkout=cancelled → "Checkout cancelled"
 *
 *              Plan provisioning is event-driven (webhook → User row update),
 *              so on success the page may briefly show the previous plan tier
 *              while the webhook lands. The page reloads automatically once
 *              the webhook arrives via `router.refresh()` from a future
 *              session — for now, the success banner instructs the user to
 *              refresh if needed.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { PricingTable } from '@/components/billing/PricingTable';
import { SubscriptionCard } from '@/components/billing/SubscriptionCard';
import { Alert } from '@/components/ui/alert';
import { requireCurrentUser } from '@/lib/auth/getCurrentUser';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Billing & plans' };

interface BillingPageProps {
  searchParams: { checkout?: string };
}

export default async function BillingPage({ searchParams }: BillingPageProps) {
  const authUser = await requireCurrentUser('/settings/billing');

  // Read the canonical row from the DB so we get the latest webhook-applied state.
  const user = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: {
      planTier: true,
      subscriptionStatus: true,
      currentPeriodEnd: true,
      stripeCustomerId: true,
    },
  });
  if (!user) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground">User profile not found.</p>
      </div>
    );
  }

  const checkoutBanner = searchParams.checkout;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link
          href="/settings"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Settings
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Billing & plans</h1>
        <p className="text-sm text-muted-foreground">
          Manage your subscription and switch plans. Powered by Stripe.
        </p>
      </header>

      {checkoutBanner === 'success' && (
        <Alert>
          <p className="text-sm font-medium">Subscription started</p>
          <p className="text-xs text-muted-foreground">
            Your new plan will appear here once Stripe finishes provisioning
            (usually within a few seconds). Refresh the page if it doesn&apos;t
            update.
          </p>
        </Alert>
      )}

      {checkoutBanner === 'cancelled' && (
        <Alert>
          <p className="text-sm font-medium">Checkout cancelled</p>
          <p className="text-xs text-muted-foreground">
            No charge was made. Pick a plan below whenever you&apos;re ready.
          </p>
        </Alert>
      )}

      <SubscriptionCard user={user} />

      <section className="space-y-3">
        <header>
          <h2 className="text-lg font-semibold">Available plans</h2>
          <p className="text-sm text-muted-foreground">
            Switch plans any time — Stripe pro-rates the difference.
          </p>
        </header>
        <PricingTable currentTier={user.planTier} />
      </section>
    </div>
  );
}
