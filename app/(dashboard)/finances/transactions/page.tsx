/**
 * @file app/(dashboard)/finances/transactions/page.tsx
 * @description Full transaction list with type/category filters. Server-rendered.
 *              Pagination is offered via `?cursor=<uuid>` from the API; for the
 *              page-rendered list we just show the most recent 100 by default
 *              and link to per-month archives in a future iteration.
 *
 *              Gated behind PRO via plan tier check at the top.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

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
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Transactions' };

interface TransactionsPageProps {
  searchParams: { type?: string; category?: string };
}

export default async function TransactionsPage({ searchParams }: TransactionsPageProps) {
  const user = await requireCurrentUser('/finances/transactions');

  if (user.planTier === 'FREE' || user.planTier === 'STARTER') {
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <Link
            href="/finances"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Finances
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
        </header>
        <PlanGate
          requires="PRO"
          currentTier={user.planTier}
          featureName="Transaction history"
          featureDescription="Browse, filter, and edit every income/expense across your projects."
        >
          <></>
        </PlanGate>
      </div>
    );
  }

  const type =
    searchParams.type === 'INCOME' || searchParams.type === 'EXPENSE'
      ? searchParams.type
      : undefined;
  const category = searchParams.category;

  const transactions = await prisma.transaction.findMany({
    where: {
      userId: user.id,
      ...(type ? { type } : {}),
      ...(category ? { category } : {}),
    },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: 100,
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <Link
            href="/finances"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Finances
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
          <p className="text-sm text-muted-foreground">
            {transactions.length} transactions
            {type ? ` · ${type === 'INCOME' ? 'Income only' : 'Expenses only'}` : ''}
            {category ? ` · ${category}` : ''}
          </p>
        </div>
        <Button asChild>
          <Link href="/finances/transactions/new">Add transaction</Link>
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>
            Use the links to narrow down the list. Cursor pagination is available
            via the API.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 text-sm">
            <FilterLink href="/finances/transactions" label="All" active={!type && !category} />
            <FilterLink
              href="/finances/transactions?type=INCOME"
              label="Income"
              active={type === 'INCOME'}
            />
            <FilterLink
              href="/finances/transactions?type=EXPENSE"
              label="Expenses"
              active={type === 'EXPENSE'}
            />
          </div>
        </CardContent>
      </Card>

      <TransactionTable transactions={transactions} />
    </div>
  );
}

function FilterLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'rounded-full bg-primary px-3 py-1 text-primary-foreground'
          : 'rounded-full border px-3 py-1 hover:bg-muted'
      }
    >
      {label}
    </Link>
  );
}
