/**
 * @file lib/stripe/webhookEvents.ts
 * @description Pure handlers for the five Stripe webhook events ScopeGuard
 *              cares about. Each handler is a Promise that returns void on
 *              success or throws on a mismatch (unknown user, unknown price).
 *              The route handler in app/api/webhooks/stripe/route.ts owns
 *              signature verification + dispatch.
 *
 *              Events handled:
 *                - checkout.session.completed
 *                - customer.subscription.updated
 *                - customer.subscription.deleted
 *                - invoice.payment_succeeded
 *                - invoice.payment_failed
 *
 *              Idempotency: Stripe retries deliver the same event ID. We
 *              store no event log of our own; instead each handler is a
 *              "set state to X" operation derived from the event payload, so
 *              re-processing is a no-op.
 */

import type Stripe from 'stripe';

import { prisma } from '@/lib/prisma';
import { tierFromPriceId } from '@/lib/stripe/plans';
import { logger } from '@/lib/utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Statuses we treat as "the user has access to their paid features." */
const ACTIVE_STATUSES = new Set(['active', 'trialing']);

interface SubscriptionStateUpdate {
  stripeSubscriptionId: string;
  stripePriceId: string | null;
  subscriptionStatus: string;
  currentPeriodEnd: Date | null;
  /** Resolved from `stripePriceId`. Falls back to FREE on terminal states. */
  planTier: 'FREE' | 'STARTER' | 'PRO' | 'BUSINESS';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the User-table fields from a Stripe Subscription object.
 * Falls back to FREE when the subscription is canceled/unpaid/incomplete.
 */
export function subscriptionStateFromStripe(
  subscription: Stripe.Subscription,
): SubscriptionStateUpdate {
  const item = subscription.items.data[0];
  const priceId = item?.price.id ?? null;
  const tier = priceId ? tierFromPriceId(priceId) : null;

  // If the subscription is not "alive" (canceled, unpaid, incomplete_expired),
  // drop the user back to FREE regardless of which price they had.
  const access = ACTIVE_STATUSES.has(subscription.status);
  const resolvedTier = access && tier ? tier : 'FREE';

  return {
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    subscriptionStatus: subscription.status,
    currentPeriodEnd: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : null,
    planTier: resolvedTier,
  };
}

/**
 * Find a user row by Stripe customer ID. Throws if no user matches — the
 * caller (route handler) catches this and returns a 200-with-reason so
 * Stripe doesn't retry forever on a permanently-missing user.
 */
async function findUserByCustomerId(customerId: string) {
  const user = await prisma.user.findUnique({
    where: { stripeCustomerId: customerId },
    select: { id: true, planTier: true },
  });
  if (!user) {
    throw new Error(`No user with stripeCustomerId=${customerId}`);
  }
  return user;
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

/**
 * Handle `checkout.session.completed`. The session contains the new
 * subscription ID; we fetch the subscription via the Stripe API to read its
 * current state, then update the user row.
 *
 * @param session - The Stripe Checkout Session from the event payload.
 * @param stripe - Stripe SDK instance for the follow-up subscription read.
 */
export async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
  stripe: Stripe,
): Promise<void> {
  if (session.mode !== 'subscription') {
    // We only use Stripe Checkout for subscriptions today. Future one-time
    // payments (e.g. CPA-export bundle) would land here with a different mode.
    logger.info('stripe.webhook.checkout_completed.non_subscription', {
      sessionId: session.id,
      mode: session.mode,
    });
    return;
  }

  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id;

  if (!customerId || !subscriptionId) {
    throw new Error(
      `checkout.session.completed missing customer or subscription (sessionId=${session.id})`,
    );
  }

  // Stripe's session.subscription is just an ID; fetch the full object so we
  // can read items/price/status without trusting the (possibly empty) snapshot.
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const state = subscriptionStateFromStripe(subscription);

  const user = await findUserByCustomerId(customerId);

  await prisma.user.update({
    where: { id: user.id },
    data: state,
  });

  logger.info('stripe.webhook.checkout_completed.applied', {
    userId: user.id,
    customerId,
    subscriptionId,
    planTier: state.planTier,
    status: state.subscriptionStatus,
  });
}

/**
 * Handle `customer.subscription.updated`. Fired on plan change, trial end,
 * status transitions (active → past_due → canceled), and quantity/price changes.
 */
export async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription,
): Promise<void> {
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;

  const state = subscriptionStateFromStripe(subscription);
  const user = await findUserByCustomerId(customerId);

  await prisma.user.update({
    where: { id: user.id },
    data: state,
  });

  logger.info('stripe.webhook.subscription_updated.applied', {
    userId: user.id,
    subscriptionId: subscription.id,
    status: state.subscriptionStatus,
    planTier: state.planTier,
  });
}

/**
 * Handle `customer.subscription.deleted`. Drops the user to FREE and clears
 * subscription IDs. We keep `stripeCustomerId` so re-subscribing reuses the
 * existing customer + payment methods.
 */
export async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
): Promise<void> {
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;

  const user = await findUserByCustomerId(customerId);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      planTier: 'FREE',
      stripeSubscriptionId: null,
      stripePriceId: null,
      subscriptionStatus: subscription.status,
      currentPeriodEnd: null,
    },
  });

  logger.info('stripe.webhook.subscription_deleted.applied', {
    userId: user.id,
    subscriptionId: subscription.id,
    finalStatus: subscription.status,
  });
}

/**
 * Handle `invoice.payment_succeeded`. Mostly informational — the
 * `customer.subscription.updated` event that follows carries the canonical
 * status. We log so failed-then-recovered renewals are visible in metrics.
 */
export async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const customerId =
    typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;

  logger.info('stripe.webhook.invoice_paid', {
    customerId,
    invoiceId: invoice.id,
    amountPaid: invoice.amount_paid,
    currency: invoice.currency,
  });
}

/**
 * Handle `invoice.payment_failed`. Stripe will retry per the dunning settings;
 * we just record the warning. The `customer.subscription.updated` event that
 * follows will flip `subscriptionStatus` to `past_due`.
 */
export async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId =
    typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;

  logger.warn('stripe.webhook.invoice_payment_failed', {
    customerId,
    invoiceId: invoice.id,
    attemptCount: invoice.attempt_count,
    nextPaymentAttempt: invoice.next_payment_attempt
      ? new Date(invoice.next_payment_attempt * 1000).toISOString()
      : null,
  });
}
