/**
 * @file components/finances/SummaryCards.tsx
 * @description Server component rendering one income/expense/net card row
 *              per currency bucket. Multi-currency users see N rows; the
 *              dashboard renders these without any conversion (v1).
 */

import type { PLBucket } from '@/lib/finances/aggregate';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card';
import { formatMoney } from '@/lib/utils/currency';
import { cn } from '@/lib/utils/cn';

interface SummaryCardsProps {
  buckets: readonly PLBucket[];
  /** Optional label for the period being summarised (e.g. "April 2026"). */
  periodLabel?: string;
}

export function SummaryCards({ buckets, periodLabel }: SummaryCardsProps) {
  if (buckets.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardDescription>
            No transactions yet
            {periodLabel ? ` for ${periodLabel}` : ''}. Add one to see your P&amp;L.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {buckets.map((b) => (
        <CurrencyRow key={b.currency} bucket={b} periodLabel={periodLabel} />
      ))}
    </div>
  );
}

function CurrencyRow({
  bucket,
  periodLabel,
}: {
  bucket: PLBucket;
  periodLabel?: string;
}) {
  const netNumber = Number(bucket.net);
  const netPositive = netNumber >= 0;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <StatCard
        label={`Income${periodLabel ? ` · ${periodLabel}` : ''}`}
        value={formatMoney(bucket.income, bucket.currency)}
        accentClassName="text-[hsl(var(--verdict-in-scope))]"
      />
      <StatCard
        label="Expenses"
        value={formatMoney(bucket.expense, bucket.currency)}
        accentClassName="text-[hsl(var(--verdict-out-of-scope))]"
      />
      <StatCard
        label={netPositive ? 'Net profit' : 'Net loss'}
        value={formatMoney(bucket.net, bucket.currency)}
        accentClassName={
          netPositive
            ? 'text-[hsl(var(--verdict-in-scope))]'
            : 'text-[hsl(var(--verdict-out-of-scope))]'
        }
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  accentClassName,
}: {
  label: string;
  value: string;
  accentClassName?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 space-y-1">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={cn('text-2xl font-bold tabular-nums', accentClassName)}>{value}</p>
      </CardContent>
    </Card>
  );
}
