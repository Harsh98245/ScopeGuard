/**
 * @file app/api/billing/portal/route.ts
 * @description Creates a Stripe Customer Portal session and returns its URL.
 *              The portal lets users update payment methods, view invoices,
 *              switch plans, and cancel — all without us building that UI.
 *
 *              Requires the user to already have a Stripe customer ID (set
 *              on first checkout). Free users hitting this endpoint get a
 *              409 with a helpful message rather than a Stripe API error.
 */

import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { prisma } from '@/lib/prisma';
import { getStripe } from '@/lib/stripe/client';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ApiError {
  error: { code: string; message: string };
}

function err(code: string, message: string, status: number) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

function resolveBaseUrl(): string {
  const explicit = process.env['NEXT_PUBLIC_APP_URL'];
  if (explicit) return explicit;
  const vercel = process.env['VERCEL_URL'];
  if (vercel) return `https://${vercel}`;
  return 'http://localhost:3000';
}

export async function POST() {
  const authUser = await getCurrentUser();
  if (!authUser) return err('UNAUTHENTICATED', 'Sign in required.', 401);

  const user = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: { stripeCustomerId: true },
  });

  if (!user?.stripeCustomerId) {
    return err(
      'NO_CUSTOMER',
      'You need an active subscription before opening the billing portal.',
      409,
    );
  }

  const stripe = getStripe();
  const baseUrl = resolveBaseUrl();

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${baseUrl}/settings/billing`,
    });

    logger.info('billing.portal.session_created', {
      userId: authUser.id,
      sessionId: session.id,
    });

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (e) {
    logger.error('billing.portal.create_failed', {
      userId: authUser.id,
      message: e instanceof Error ? e.message : String(e),
    });
    return err('STRIPE_ERROR', 'Could not open the billing portal. Please try again.', 502);
  }
}
