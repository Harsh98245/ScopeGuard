/**
 * @file app/(dashboard)/finances/transactions/new/page.tsx
 * @description Manual transaction entry page. Server component checks auth +
 *              plan tier; renders an `AddTransactionForm` client island.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { AddTransactionForm } from '@/components/finances/AddTransactionForm';
import { PlanGate } from '@/components/billing/PlanGate';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { requireCurrentUser } from '@/lib/auth/getCurrentUser';
import { TAX_DEFAULT_CURRENCY } from '@/lib/finances/tax';

export const metadata: Metadata = { title: 'Add transaction' };

export default async function NewTransactionPage() {
  const user = await requireCurrentUser('/finances/transactions/new');

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
          <h1 className="text-2xl font-semibold tracking-tight">Add transaction</h1>
        </header>
        <PlanGate
          requires="PRO"
          currentTier={user.planTier}
          featureName="Manual transactions"
          featureDescription="Record income and expenses manually until your integrations are connected."
        >
          <></>
        </PlanGate>
      </div>
    );
  }

  const defaultCurrency = TAX_DEFAULT_CURRENCY[user.jurisdiction];

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link
          href="/finances/transactions"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Transactions
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Add transaction</h1>
        <p className="text-sm text-muted-foreground">
          Manually record an income or expense. The AI will categorise expenses if you
          leave the category blank.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>New transaction</CardTitle>
          <CardDescription>All fields except amount and currency are optional.</CardDescription>
        </CardHeader>
        <CardContent>
          <AddTransactionForm defaultCurrency={defaultCurrency} />
        </CardContent>
      </Card>
    </div>
  );
}
