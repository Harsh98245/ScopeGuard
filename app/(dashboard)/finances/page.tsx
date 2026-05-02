/**
 * @file app/(dashboard)/finances/page.tsx
 * @description Financial OS dashboard. Shows month-to-date P&L summary,
 *              category breakdown for expenses, projected annual tax
 *              set-aside, and quick links to add a transaction or view the
 *              full list.
 *
 *              Gated behind PRO via the `PlanGate` server component — FREE
 *              and STARTER users see an upgrade card instead of the dashboard.
 *              PRO/BUSINESS users see the full dashboard, with empty-state
 *              copy when no transactions exist yet.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { CategoryBreakdown } from '@/components/finances/CategoryBreakdown';
import { SummaryCards } from '@/components/finances/SummaryCards';
import { TaxEstimateCard } from '@/components/finances/TaxEstimateCard';
import { TransactionTable } from '@/components/finances/TransactionTable';
import { PlanGate } from '@/components/billing/PlanGate';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { requireCurrentUser } from '@/lib/auth/getCurrentUser';
import { expenseByCategory, projectAnnualNet, summarise } from '@/lib/finances/aggregate';
import { TAX_DEFAULT_CURRENCY, estimateTaxFor } from '@/lib/finances/tax';
import { prisma } from '@/lib/prisma';
import { sumMoney } from '@/lib/utils/currency';

export const metadata: Metadata = { title: 'Finances' };

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export default async function FinancesPage() {
  const user = await requireCurrentUser('/finances');

  // Render the upgrade card for non-PRO users — no data fetched.
  if (user.planTier === 'FREE' || user.planTier === 'STARTER') {
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Finances</h1>
          <p className="text-sm text-muted-foreground">
            Unified P&amp;L, AI-categorised expenses, and quarterly tax estimates.
          </p>
        </header>
        <PlanGate
          requires="PRO"
          currentTier={user.planTier}
          featureName="Financial OS"
          featureDescription="Track unified P&L, get AI-categorised expenses, and surface quarterly tax estimates for US/CA/UK."
        >
          <></>
        </PlanGate>
      </div>
    );
  }

  // ---- PRO/BUSINESS path: load data and render the dashboard ----
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const monthLabel = `${MONTH_LABELS[now.getUTCMonth()] ?? ''} ${now.getUTCFullYear()}`;
  const targetCurrency = TAX_DEFAULT_CURRENCY[user.jurisdiction];

  const [monthTransactions, ytdTransactions, recentTransactions] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId: user.id, occurredAt: { gte: monthStart, lte: now } },
      select: { amount: true, currency: true, type: true, category: true, occurredAt: true },
    }),
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        currency: targetCurrency,
        occurredAt: { gte: yearStart, lte: now },
      },
      select: { amount: true, currency: true, type: true, taxDeductible: true },
    }),
    prisma.transaction.findMany({
      where: { userId: user.id },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: 10,
    }),
  ]);

  // Month-to-date P&L buckets.
  const monthBuckets = summarise(
    monthTransactions.map((t) => ({
      amount: t.amount.toString(),
      currency: t.currency,
      type: t.type,
      category: t.category,
      occurredAt: t.occurredAt,
    })),
  );

  // Per-currency category breakdown for expenses.
  const categoryBuckets = monthBuckets.map((bucket) => ({
    currency: bucket.currency,
    buckets: expenseByCategory(
      monthTransactions
        .filter((t) => t.currency === bucket.currency)
        .map((t) => ({
          amount: t.amount.toString(),
          currency: t.currency,
          type: t.type,
          category: t.category,
          occurredAt: t.occurredAt,
        })),
    ),
  }));

  // Tax estimate from YTD activity in the user's native currency.
  const incomeYTD = sumMoney(
    ytdTransactions.filter((t) => t.type === 'INCOME').map((t) => t.amount.toString()),
  );
  const deductibleYTD = sumMoney(
    ytdTransactions
      .filter((t) => t.type === 'EXPENSE' && t.taxDeductible)
      .map((t) => t.amount.toString()),
  );
  const netYTD = (Number(incomeYTD) - Number(deductibleYTD) || 0).toFixed(2);
  const annualNet = projectAnnualNet(netYTD, now);

  const taxEstimate = estimateTaxFor(user.jurisdiction, {
    annualNetIncome: annualNet,
    currency: targetCurrency,
    annualGrossIncome: projectAnnualNet(incomeYTD, now),
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finances</h1>
          <p className="text-sm text-muted-foreground">
            P&amp;L for {monthLabel}, with quarterly tax set-aside.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/finances/transactions">All transactions →</Link>
          </Button>
          <Button asChild>
            <Link href="/finances/transactions/new">Add transaction</Link>
          </Button>
        </div>
      </header>

      <SummaryCards buckets={monthBuckets} periodLabel={monthLabel} />

      <div className="grid gap-4 lg:grid-cols-2">
        <TaxEstimateCard
          estimate={taxEstimate}
          yearToDate={{ income: incomeYTD, deductibleExpenses: deductibleYTD, net: netYTD }}
          projectedAnnualNet={annualNet}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Where the money went</CardTitle>
            <CardDescription>Expense categories for {monthLabel}.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {categoryBuckets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No expenses this month.</p>
            ) : (
              categoryBuckets.map((cb) => (
                <div key={cb.currency} className="space-y-2">
                  {categoryBuckets.length > 1 && (
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {cb.currency}
                    </p>
                  )}
                  <CategoryBreakdown buckets={cb.buckets} currency={cb.currency} />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-lg">Recent activity</CardTitle>
            <CardDescription>The last 10 transactions across all currencies.</CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/finances/transactions">View all →</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <TransactionTable transactions={recentTransactions} />
        </CardContent>
      </Card>
    </div>
  );
}
