/**
 * @file components/finances/TransactionTable.tsx
 * @description Server component listing transactions in a compact table.
 *              Each row shows: date, type badge, description, category,
 *              amount (currency-formatted), and a deductibility marker.
 *
 *              Inline edit + delete is exposed by `TransactionRowActions`
 *              (a client island) on each row — keeping the table itself a
 *              server component and lazy-hydrating the small interactive bits.
 */

import type { Transaction } from '@prisma/client';

import { TransactionRowActions } from '@/components/finances/TransactionRowActions';
import { Badge } from '@/components/ui/badge';
import { categoryLabel } from '@/lib/finances/categories';
import { formatMoney } from '@/lib/utils/currency';
import { cn } from '@/lib/utils/cn';

interface TransactionTableProps {
  transactions: readonly Transaction[];
  /** Whether to render the actions column (Edit/Delete). Default true. */
  showActions?: boolean;
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

export function TransactionTable({ transactions, showActions = true }: TransactionTableProps) {
  if (transactions.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center">
        <p className="text-sm text-muted-foreground">No transactions in this view.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Date</th>
            <th className="px-3 py-2 text-left font-medium">Type</th>
            <th className="px-3 py-2 text-left font-medium">Description</th>
            <th className="px-3 py-2 text-left font-medium">Category</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
            <th className="px-3 py-2 text-center font-medium">Deductible</th>
            {showActions && <th className="px-3 py-2 text-right font-medium">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx, i) => (
            <tr
              key={tx.id}
              className={cn(
                'border-b last:border-0 transition-colors hover:bg-muted/30',
                i % 2 === 0 ? '' : 'bg-muted/10',
              )}
            >
              <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                {formatShortDate(tx.occurredAt)}
              </td>
              <td className="px-3 py-2">
                <Badge
                  variant={tx.type === 'INCOME' ? 'success' : 'outline'}
                  className="text-xs"
                >
                  {tx.type === 'INCOME' ? 'In' : 'Out'}
                </Badge>
              </td>
              <td className="px-3 py-2 max-w-[280px] truncate">
                {tx.description ?? <span className="italic text-muted-foreground">—</span>}
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {tx.category ? (
                  categoryLabel(tx.category)
                ) : tx.type === 'EXPENSE' ? (
                  <span className="italic text-xs">Categorising…</span>
                ) : (
                  <span className="italic text-xs">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums font-medium whitespace-nowrap">
                {formatMoney(tx.amount.toString(), tx.currency)}
              </td>
              <td className="px-3 py-2 text-center text-xs">
                {tx.type === 'EXPENSE' ? (
                  tx.taxDeductible ? (
                    <span aria-label="Tax deductible">✓</span>
                  ) : (
                    <span className="text-muted-foreground" aria-label="Not deductible">
                      –
                    </span>
                  )
                ) : (
                  <span className="text-muted-foreground" aria-label="N/A">
                    —
                  </span>
                )}
              </td>
              {showActions && (
                <td className="px-3 py-2 text-right">
                  <TransactionRowActions transactionId={tx.id} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
