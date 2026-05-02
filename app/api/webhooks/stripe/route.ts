/**
 * @file app/api/webhooks/stripe/route.ts
 * @description Stripe webhook receiver. Verifies the `Stripe-Signature`
 *              header, parses the event, and dispatches to one of the
 *              typed handlers in `lib/stripe/webhookEvents.ts`.
 *
 *              Always returns 200 within milliseconds for signed events. The
 *              only 4xx returned is 401 on signature verification failure
 *              (Stripe retries on 5xx; we want signature failures to short-circuit
 *              retries since the secret is misconfigured rather than transient).
 *
 *              Events we handle:
 *                - checkout.session.completed
 *                - customer.subscription.updated
 *                - customer.subscription.deleted
 *                - invoice.paid
 *                - invoice.payment_failed
 *
 *              Events we don't handle return 200 with `{ accepted: true, ignored: true }`
 *              so Stripe stops retrying, but the dashboard shows the dead-letter for audit.
 */

import { NextResponse } from 'next/server';
import type Stripe from 'stripe';

import { getStripe } from '@/lib/stripe/client';
import {
  handleCheckoutSessionCompleted,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
  handleSubscriptionDeleted,
  handleSubscriptionUpdated,
} from '@/lib/stripe/webhookEvents';
import { checkIpLimit, stripeWebhookLimiter } from '@/lib/utils/ipRateLimit';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ApiError {
  error: { code: string; message: string };
}

function err(code: string, message: string, status: number) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

/**
 * Verify the Stripe webhook signature using the raw request body and the
 * shared secret. Returns the parsed Event on success or null on failure.
 */
function verifyAndParse(
  rawBody: string,
  signatureHeader: string | null,
): Stripe.Event | null {
  const secret = process.env['STRIPE_WEBHOOK_SECRET'];
  if (!secret || !signatureHeader) return null;

  try {
    return getStripe().webhooks.constructEvent(rawBody, signatureHeader, secret);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // IP-based rate limit BEFORE we read the body. Forged requests stop here
  // and never burn signature-verification CPU.
  const limited = await checkIpLimit(stripeWebhookLimiter, request);
  if (limited) {
    logger.warn('stripe.webhook.rate_limited', { ip: limited.ip });
    return NextResponse.json<ApiError>(
      { error: { code: 'RATE_LIMITED', message: 'Too many requests.' } },
      { status: 429, headers: limited.headers },
    );
  }

  // Stripe's signature is computed over the EXACT raw body bytes — we cannot
  // call request.json() first, because Next.js's parser may normalise whitespace.
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');

  const event = verifyAndParse(rawBody, signature);
  if (!event) {
    logger.warn('stripe.webhook.signature_verification_failed', {
      hasSignature: signature !== null,
    });
    return err('UNAUTHENTICATED', 'Invalid signature.', 401);
  }

  // Dispatch — every handler is idempotent so Stripe retries are safe.
  try {
    const stripe = getStripe();
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(
          event.data.object as Stripe.Checkout.Session,
          stripe,
        );
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.paid':
      case 'invoice.payment_succeeded':
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        // Acknowledged but ignored — visible in the Stripe dashboard so we can
        // tune the configured event subscriptions without retries piling up.
        logger.info('stripe.webhook.event_ignored', { type: event.type, eventId: event.id });
        return NextResponse.json({ accepted: true, ignored: true }, { status: 200 });
    }

    logger.info('stripe.webhook.event_handled', {
      type: event.type,
      eventId: event.id,
    });

    return NextResponse.json({ accepted: true }, { status: 200 });
  } catch (e) {
    // Returning 5xx triggers Stripe's retry; that's the right behaviour for
    // transient failures (DB blip, Stripe API timeout). For permanent
    // failures (unknown user, malformed payload), the handler throws and
    // Stripe retries until the alert fires — better than silently losing the event.
    logger.error('stripe.webhook.handler_failed', {
      type: event.type,
      eventId: event.id,
      message: e instanceof Error ? e.message : String(e),
    });
    return err('INTERNAL', 'Webhook handler failed.', 500);
  }
}
