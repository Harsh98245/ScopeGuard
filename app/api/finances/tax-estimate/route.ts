/**
 * @file app/api/finances/tax-estimate/route.ts
 * @description Returns the projected annual tax estimate for the signed-in
 *              user. Steps:
 *                1. Pull all year-to-date transactions in the user's
 *                   jurisdiction's native currency.
 *                2. Compute net income (income − deductible expenses).
 *                3. Annualise via `projectAnnualNet`.
 *                4. Run the per-jurisdiction estimator from `lib/finances/tax`.
 *
 *              Non-deductible expenses are EXCLUDED from the deduction side —
 *              the assumption is that the user has flipped `taxDeductible` to
 *              true on every business expense (the AI seeds this; the user
 *              can override).
 *
 *              Gated behind the Financial OS plan.
 */

import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { projectAnnualNet, summarise } from '@/lib/finances/aggregate';
import { TAX_DEFAULT_CURRENCY, estimateTaxFor } from '@/lib/finances/tax';
import { prisma } from '@/lib/prisma';
import { getPlanLimits } from '@/lib/stripe/plans';
import { sumMoney } from '@/lib/utils/currency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ApiError {
  error: { code: string; message: string };
}
function err(code: string, message: string, status: number) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

function startOfYearUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return err('UNAUTHENTICATED', 'Sign in required.', 401);

  if (!getPlanLimits(user.planTier).hasFinancialOS) {
    return err('PLAN_LIMIT_EXCEEDED', 'Financial OS requires the Pro plan.', 402);
  }

  const targetCurrency = TAX_DEFAULT_CURRENCY[user.jurisdiction];
  const now = new Date();
  const yearStart = startOfYearUtc(now);

  // Year-to-date transactions in the user's jurisdictional currency only.
  const transactions = await prisma.transaction.findMany({
    where: {
      userId: user.id,
      currency: targetCurrency,
      occurredAt: { gte: yearStart, lte: now },
    },
    select: {
      amount: true,
      currency: true,
      type: true,
      category: true,
      taxDeductible: true,
      occurredAt: true,
    },
  });

  // YTD income = sum of INCOME amounts.
  // YTD deductible expenses = sum of EXPENSE amounts where taxDeductible is true.
  const incomeAmounts = transactions
    .filter((t) => t.type === 'INCOME')
    .map((t) => t.amount.toString());
  const deductibleAmounts = transactions
    .filter((t) => t.type === 'EXPENSE' && t.taxDeductible)
    .map((t) => t.amount.toString());

  const ytdIncome = sumMoney(incomeAmounts);
  const ytdDeductible = sumMoney(deductibleAmounts);

  // YTD net = income − deductible expenses (use summarise() for the
  // intermediate income/expense figures on the response).
  const buckets = summarise(
    transactions.map((t) => ({
      amount: t.amount.toString(),
      currency: t.currency,
      type: t.type,
      category: t.category,
      occurredAt: t.occurredAt,
    })),
  );

  const ytdNet = (() => {
    const incomeMinor = BigInt(Math.round(Number(ytdIncome) * 100));
    const deductMinor = BigInt(Math.round(Number(ytdDeductible) * 100));
    const net = incomeMinor - deductMinor;
    return (Number(net) / 100).toFixed(2);
  })();

  const annualNet = projectAnnualNet(ytdNet, now);

  const estimate = estimateTaxFor(user.jurisdiction, {
    annualNetIncome: annualNet,
    currency: targetCurrency,
    annualGrossIncome: projectAnnualNet(ytdIncome, now),
  });

  return NextResponse.json({
    jurisdiction: user.jurisdiction,
    yearToDate: {
      income: ytdIncome,
      deductibleExpenses: ytdDeductible,
      net: ytdNet,
    },
    projectedAnnualNet: annualNet,
    estimate,
    buckets,
  });
}
