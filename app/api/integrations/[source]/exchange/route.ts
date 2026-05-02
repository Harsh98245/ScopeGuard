/**
 * @file app/api/integrations/[source]/exchange/route.ts
 * @description Plaid public-token → access-token exchange. Plaid Link runs
 *              in-page (no redirect), so it returns the public_token to JS;
 *              the client POSTs it here, the route runs the driver's
 *              `handleCallback`, and persists the Integration row.
 *
 *              Currently only `source=PLAID` is valid — every other source
 *              uses the redirect-based callback at /[source]/callback.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { inngest } from '@/inngest/client';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { plaidIntegrationDriver } from '@/lib/integrations/plaid';
import { prisma } from '@/lib/prisma';
import { encryptToken } from '@/lib/utils/encryption';
import { logger } from '@/lib/utils/logger';
import { getPlanLimits } from '@/lib/stripe/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RequestSchema = z.object({
  publicToken: z.string().min(1),
  state: z.string().min(1),
});

interface ApiError {
  error: { code: string; message: string };
}
function err(code: string, message: string, status: number) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

interface RouteContext {
  params: { source: string };
}

export async function POST(request: Request, { params }: RouteContext) {
  if (params.source.toUpperCase() !== 'PLAID') {
    return err('UNSUPPORTED', 'Only PLAID supports the exchange endpoint.', 404);
  }

  const user = await getCurrentUser();
  if (!user) return err('UNAUTHENTICATED', 'Sign in required.', 401);
  if (!getPlanLimits(user.planTier).hasFinancialOS) {
    return err('PLAN_LIMIT_EXCEEDED', 'Integrations require the Pro plan.', 402);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err('INVALID_JSON', 'Body must be JSON.', 400);
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return err('VALIDATION_FAILED', 'Invalid body.', 400);

  try {
    const result = await plaidIntegrationDriver.handleCallback({
      publicToken: parsed.data.publicToken,
      state: parsed.data.state,
      userId: user.id,
    });

    const accessToken = encryptToken(result.accessToken);
    const integration = await prisma.integration.upsert({
      where: { userId_source: { userId: user.id, source: 'PLAID' } },
      create: {
        userId: user.id,
        source: 'PLAID',
        accessToken,
        isActive: true,
        metadata: (result.metadata ?? {}) as Record<string, unknown>,
      },
      update: {
        accessToken,
        isActive: true,
        metadata: (result.metadata ?? {}) as Record<string, unknown>,
      },
    });

    await inngest.send({
      name: 'integration/connected',
      data: { userId: user.id, integrationId: integration.id },
    });

    logger.info('integrations.plaid.exchanged', {
      userId: user.id,
      integrationId: integration.id,
    });

    return NextResponse.json({ ok: true, integrationId: integration.id }, { status: 201 });
  } catch (e) {
    logger.error('integrations.plaid.exchange_failed', {
      userId: user.id,
      message: e instanceof Error ? e.message : String(e),
    });
    return err('PROVIDER_ERROR', 'Plaid exchange failed.', 502);
  }
}
