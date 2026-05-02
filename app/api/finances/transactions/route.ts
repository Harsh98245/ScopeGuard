/**
 * @file app/api/finances/transactions/route.ts
 * @description Transactions collection endpoint.
 *                - GET  /api/finances/transactions   — paginated list with filters.
 *                - POST /api/finances/transactions   — manual entry.
 *
 *              Both endpoints are gated behind the Financial OS plan (PRO+);
 *              FREE/STARTER callers receive HTTP 402.
 *
 *              POST inserts a row; if `category` was omitted on an EXPENSE,
 *              fires the `transaction/created` Inngest event so the AI
 *              categoriser can fill it in asynchronously.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { inngest } from '@/inngest/client';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { prisma } from '@/lib/prisma';
import { getPlanLimits } from '@/lib/stripe/plans';
import { logger } from '@/lib/utils/logger';
import {
  CurrencyCodeSchema,
  MoneyStringSchema,
} from '@/lib/utils/validation';
import { EXPENSE_CATEGORIES } from '@/lib/finances/categories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const CreateTransactionSchema = z.object({
  type: z.enum(['INCOME', 'EXPENSE']),
  amount: MoneyStringSchema,
  currency: CurrencyCodeSchema,
  description: z.string().max(500).optional(),
  category: z
    .enum(EXPENSE_CATEGORIES as readonly string[] as readonly [string, ...string[]])
    .optional(),
  taxDeductible: z.boolean().optional(),
  occurredAt: z.string().datetime().optional(),
});

const ListQuerySchema = z.object({
  type: z.enum(['INCOME', 'EXPENSE']).optional(),
  category: z.string().max(64).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
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

// ---------------------------------------------------------------------------
// GET — list
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return err('UNAUTHENTICATED', 'Sign in required.', 401);

  if (!getPlanLimits(user.planTier).hasFinancialOS) {
    return err('PLAN_LIMIT_EXCEEDED', 'Financial OS requires the Pro plan.', 402);
  }

  const url = new URL(request.url);
  const parsed = ListQuerySchema.safeParse({
    type: url.searchParams.get('type') ?? undefined,
    category: url.searchParams.get('category') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  });
  if (!parsed.success) return err('VALIDATION_FAILED', 'Invalid query.', 400);

  const { type, category, from, to, limit, cursor } = parsed.data;

  const transactions = await prisma.transaction.findMany({
    where: {
      userId: user.id,
      ...(type ? { type } : {}),
      ...(category ? { category } : {}),
      ...(from || to
        ? {
            occurredAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: limit + 1, // +1 sentinel to know if there's a next page
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = transactions.length > limit;
  const page = hasMore ? transactions.slice(0, limit) : transactions;

  return NextResponse.json({
    transactions: page.map((t) => ({
      ...t,
      amount: t.amount.toString(),
      occurredAt: t.occurredAt.toISOString(),
      createdAt: t.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  });
}

// ---------------------------------------------------------------------------
// POST — create
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
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

  const parsed = CreateTransactionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_FAILED', message: 'Invalid body.', fields: parsed.error.flatten().fieldErrors } },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const occurredAt = data.occurredAt ? new Date(data.occurredAt) : new Date();

  // Manual entries get a synthetic externalId so the (source, externalId)
  // unique constraint stays consistent. Format: manual:<uuid> generated client-side via crypto.
  const externalId = `manual:${crypto.randomUUID()}`;

  const tx = await prisma.transaction.create({
    data: {
      userId: user.id,
      source: 'STRIPE', // Sentinel for manual entries until session 10 adds an INTERNAL/MANUAL enum value.
      externalId,
      type: data.type,
      amount: data.amount,
      currency: data.currency,
      description: data.description ?? null,
      category: data.category ?? null,
      taxDeductible: data.taxDeductible ?? false,
      occurredAt,
    },
  });

  // Fire AI categorise event if user didn't supply a category for an EXPENSE.
  if (tx.type === 'EXPENSE' && tx.category === null) {
    await inngest.send({
      name: 'transaction/created',
      data: { userId: user.id, transactionId: tx.id },
    });
  }

  logger.info('finances.transaction.created', {
    userId: user.id,
    transactionId: tx.id,
    type: tx.type,
    amount: tx.amount.toString(),
    currency: tx.currency,
    aiCategorise: tx.type === 'EXPENSE' && tx.category === null,
  });

  return NextResponse.json(
    {
      ...tx,
      amount: tx.amount.toString(),
      occurredAt: tx.occurredAt.toISOString(),
      createdAt: tx.createdAt.toISOString(),
    },
    { status: 201 },
  );
}
