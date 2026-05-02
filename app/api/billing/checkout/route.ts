/**
 * @file app/api/billing/checkout/route.ts
 * @description Creates a Stripe Checkout Session and returns its URL. The
 *              client (CheckoutButton) redirects the browser to that URL.
 *
 *              Flow:
 *                1. Authenticate the caller.
 *                2. Validate `tier` (must be a paid tier with a configured price ID).
 *                3. Resolve or create the Stripe Customer for the user.
 *                4. Create a subscription-mode Checkout Session.
 *                5. Return { url } so the client can `window.location.href = url`.
 *
 *              The `success_url` and `cancel_url` both come back to
 *              /settings/billing — Stripe webhook events provision the plan
 *              tier; the redirect itself is purely presentational.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { prisma } from '@/lib/prisma';
import { getStripe } from '@/lib/stripe/client';
import { PLANS } from '@/lib/stripe/plans';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const RequestSchema = z.object({
  tier: z.enum(['STARTER', 'PRO', 'BUSINESS']),
});

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
 * Resolve the user's Stripe customer ID, creating a customer record on first
 * checkout. The customer ID is then persisted on the User row so subsequent
 * checkouts and the Customer Portal reuse the same customer.
 */
async function resolveStripeCustomer(user: {
  id: string;
  email: string;
  stripeCustomerId: string | null;
}): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: user.email,
    metadata: { userId: user.id },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

/** Resolve the absolute base URL used for success/cancel URLs. */
function resolveBaseUrl(): string {
  const explicit = process.env['NEXT_PUBLIC_APP_URL'];
  if (explicit) return explicit;
  // Vercel sets VERCEL_URL without a scheme; prepend https:// when present.
  const vercel = process.env['VERCEL_URL'];
  if (vercel) return `https://${vercel}`;
  return 'http://localhost:3000';
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const authUser = await getCurrentUser();
  if (!authUser) return err('UNAUTHENTICATED', 'Sign in required.', 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err('INVALID_JSON', 'Body must be valid JSON.', 400);
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return err('VALIDATION_FAILED', 'Invalid `tier` value.', 400);
  }

  const plan = PLANS[parsed.data.tier];
  const priceId = plan.priceId;
  if (!priceId) {
    logger.error('billing.checkout.missing_price_id', { tier: parsed.data.tier });
    return err(
      'CONFIG_ERROR',
      'Server is missing the Stripe price ID for this plan. Please retry shortly.',
      503,
    );
  }

  // Refresh user from DB so we read the freshest stripeCustomerId — the
  // session row may have been provisioned in a parallel request.
  const user = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: { id: true, email: true, stripeCustomerId: true },
  });
  if (!user) return err('NOT_FOUND', 'User profile not found.', 404);

  const customerId = await resolveStripeCustomer(user);
  const stripe = getStripe();
  const baseUrl = resolveBaseUrl();

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${baseUrl}/settings/billing?checkout=success`,
      cancel_url: `${baseUrl}/settings/billing?checkout=cancelled`,
      // Mirror metadata onto the subscription so any future webhook payload
      // surfaces the userId without an extra customer lookup.
      subscription_data: {
        metadata: { userId: user.id, tier: plan.tier },
      },
    });

    if (!session.url) {
      throw new Error('Stripe Checkout session was created without a URL.');
    }

    logger.info('billing.checkout.session_created', {
      userId: user.id,
      tier: plan.tier,
      sessionId: session.id,
    });

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (e) {
    logger.error('billing.checkout.create_failed', {
      userId: user.id,
      tier: plan.tier,
      message: e instanceof Error ? e.message : String(e),
    });
    return err('STRIPE_ERROR', 'Could not start checkout. Please try again.', 502);
  }
}
