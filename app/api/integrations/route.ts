/**
 * @file app/api/integrations/route.ts
 * @description List the current user's integrations. Encrypted token columns
 *              are NEVER returned — only metadata, status, lastSyncedAt.
 *              Gated behind PRO (matches the Financial OS gate).
 */

import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { prisma } from '@/lib/prisma';
import { getPlanLimits } from '@/lib/stripe/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ApiError {
  error: { code: string; message: string };
}
function err(code: string, message: string, status: number) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return err('UNAUTHENTICATED', 'Sign in required.', 401);
  if (!getPlanLimits(user.planTier).hasFinancialOS) {
    return err('PLAN_LIMIT_EXCEEDED', 'Integrations require the Pro plan.', 402);
  }

  const integrations = await prisma.integration.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      source: true,
      isActive: true,
      lastSyncedAt: true,
      tokenExpiresAt: true,
      metadata: true,
      createdAt: true,
      // accessToken/refreshToken intentionally OMITTED.
    },
  });

  return NextResponse.json({
    integrations: integrations.map((i) => ({
      ...i,
      lastSyncedAt: i.lastSyncedAt?.toISOString() ?? null,
      tokenExpiresAt: i.tokenExpiresAt?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
    })),
  });
}
