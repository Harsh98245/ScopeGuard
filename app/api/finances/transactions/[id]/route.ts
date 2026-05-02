/**
 * @file app/api/finances/transactions/[id]/route.ts
 * @description Per-transaction endpoint.
 *                - PATCH  — update mutable fields (category, taxDeductible, description).
 *                - DELETE — hard-delete the row.
 *
 *              Both gated behind the Financial OS plan. Both confirm
 *              ownership via a `where: { id, userId }` predicate so RLS
 *              is enforced even if the service-role client is reused.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { prisma } from '@/lib/prisma';
import { getPlanLimits } from '@/lib/stripe/plans';
import { logger } from '@/lib/utils/logger';
import { EXPENSE_CATEGORIES } from '@/lib/finances/categories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UpdateSchema = z.object({
  category: z
    .enum(EXPENSE_CATEGORIES as readonly string[] as readonly [string, ...string[]])
    .nullable()
    .optional(),
  taxDeductible: z.boolean().optional(),
  description: z.string().max(500).nullable().optional(),
});

interface ApiError {
  error: { code: string; message: string };
}
function err(code: string, message: string, status: number) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

interface RouteContext {
  params: { id: string };
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

export async function PATCH(request: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return err('UNAUTHENTICATED', 'Sign in required.', 401);

  if (!getPlanLimits(user.planTier).hasFinancialOS) {
    return err('PLAN_LIMIT_EXCEEDED', 'Financial OS requires the Pro plan.', 402);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err('INVALID_JSON', 'Body must be JSON.', 400);
  }
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return err('VALIDATION_FAILED', 'Invalid body.', 400);

  const existing = await prisma.transaction.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!existing) return err('NOT_FOUND', 'Transaction not found.', 404);

  const updated = await prisma.transaction.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.category !== undefined ? { category: parsed.data.category } : {}),
      ...(parsed.data.taxDeductible !== undefined ? { taxDeductible: parsed.data.taxDeductible } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
    },
  });

  logger.info('finances.transaction.updated', {
    userId: user.id,
    transactionId: updated.id,
    updatedFields: Object.keys(parsed.data),
  });

  return NextResponse.json({
    ...updated,
    amount: updated.amount.toString(),
    occurredAt: updated.occurredAt.toISOString(),
    createdAt: updated.createdAt.toISOString(),
  });
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

export async function DELETE(_request: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return err('UNAUTHENTICATED', 'Sign in required.', 401);

  if (!getPlanLimits(user.planTier).hasFinancialOS) {
    return err('PLAN_LIMIT_EXCEEDED', 'Financial OS requires the Pro plan.', 402);
  }

  const existing = await prisma.transaction.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!existing) return err('NOT_FOUND', 'Transaction not found.', 404);

  await prisma.transaction.delete({ where: { id: existing.id } });

  logger.info('finances.transaction.deleted', {
    userId: user.id,
    transactionId: existing.id,
  });

  return new NextResponse(null, { status: 204 });
}
