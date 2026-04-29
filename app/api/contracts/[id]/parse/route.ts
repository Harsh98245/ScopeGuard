/**
 * @file app/api/contracts/[id]/parse/route.ts
 * @description Manually re-trigger the parseContract pipeline for an
 *              existing contract. Used when the first parse failed (rare —
 *              Inngest already retries) or after the user uploads a new
 *              version.
 *
 *              Idempotent: clears `parsedAt` first so the Inngest function
 *              doesn't short-circuit.
 */

import { NextResponse } from 'next/server';

import { inngest } from '@/inngest/client';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { prisma } from '@/lib/prisma';
import { contractParseLimiter, checkLimit } from '@/lib/utils/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ApiError {
  error: { code: string; message: string };
}
function err(code: string, message: string, status: number) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

interface RouteContext {
  params: { id: string };
}

/**
 * POST /api/contracts/:id/parse
 */
export async function POST(_req: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return err('UNAUTHENTICATED', 'Sign in required.', 401);

  const limited = await checkLimit(contractParseLimiter, user.id);
  if (limited) {
    return NextResponse.json<ApiError>(
      { error: { code: 'RATE_LIMITED', message: 'Too many re-parses.' } },
      { status: 429, headers: limited.headers },
    );
  }

  const contract = await prisma.contract.findFirst({
    where: { id: params.id, project: { userId: user.id } },
    select: { id: true, projectId: true },
  });
  if (!contract) return err('NOT_FOUND', 'Contract not found.', 404);

  // Reset parsedAt so the Inngest function does the work again.
  await prisma.contract.update({
    where: { id: contract.id },
    data: { parsedAt: null },
  });

  await inngest.send({
    name: 'contract/uploaded',
    data: {
      userId: user.id,
      projectId: contract.projectId,
      contractId: contract.id,
    },
  });

  return NextResponse.json({ status: 'enqueued' }, { status: 202 });
}
