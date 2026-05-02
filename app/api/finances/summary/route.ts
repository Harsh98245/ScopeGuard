/**
 * @file app/api/finances/summary/route.ts
 * @description Returns a P&L summary for the signed-in user across a
 *              date range. Output is bucketed by currency — multi-currency
 *              users see one summary card per currency.
 *
 *              Default range: current calendar month (UTC). Custom ranges via
 *              `?from=ISO&to=ISO`. Gated behind the Financial OS plan.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { expenseByCategory, summarise } from '@/lib/finances/aggregate';
import { prisma } from '@/lib/prisma';
import { getPlanLimits } from '@/lib/stripe/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  currency: z.string().length(3).optional(),
});

interface ApiError {
  error: { code: string; message: string };
}
function err(code: string, message: string, status: number) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

function startOfMonthUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return err('UNAUTHENTICATED', 'Sign in required.', 401);

  if (!getPlanLimits(user.planTier).hasFinancialOS) {
    return err('PLAN_LIMIT_EXCEEDED', 'Financial OS requires the Pro plan.', 402);
  }

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    currency: url.searchParams.get('currency') ?? undefined,
  });
  if (!parsed.success) return err('VALIDATION_FAILED', 'Invalid query.', 400);

  const from = parsed.data.from ? new Date(parsed.data.from) : startOfMonthUtc();
  const to = parsed.data.to ? new Date(parsed.data.to) : new Date();

  const transactions = await prisma.transaction.findMany({
    where: {
      userId: user.id,
      occurredAt: { gte: from, lte: to },
      ...(parsed.data.currency ? { currency: parsed.data.currency } : {}),
    },
    select: {
      amount: true,
      currency: true,
      type: true,
      category: true,
      occurredAt: true,
    },
  });

  const buckets = summarise(
    transactions.map((t) => ({
      amount: t.amount.toString(),
      currency: t.currency,
      type: t.type,
      category: t.category,
      occurredAt: t.occurredAt,
    })),
  );

  const categoryBreakdownByCurrency: Record<
    string,
    Array<{ category: string; total: string; share: number }>
  > = {};
  for (const bucket of buckets) {
    const txsForCcy = transactions
      .filter((t) => t.currency === bucket.currency)
      .map((t) => ({
        amount: t.amount.toString(),
        currency: t.currency,
        type: t.type,
        category: t.category,
        occurredAt: t.occurredAt,
      }));
    categoryBreakdownByCurrency[bucket.currency] = expenseByCategory(txsForCcy);
  }

  return NextResponse.json({
    from: from.toISOString(),
    to: to.toISOString(),
    transactionCount: transactions.length,
    buckets,
    categoryBreakdown: categoryBreakdownByCurrency,
  });
}
