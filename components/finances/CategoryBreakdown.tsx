/**
 * @file components/finances/CategoryBreakdown.tsx
 * @description Server component showing expense totals broken out by
 *              category with a horizontal share bar. Pure presentational —
 *              data comes from `expenseByCategory` in the parent.
 */

import type { CategoryBucket } from '@/lib/finances/aggregate';
import { categoryLabel } from '@/lib/finances/categories';
import { formatMoney } from '@/lib/utils/currency';

interface CategoryBreakdownProps {
  buckets: readonly CategoryBucket[];
  currency: string;
}

export function CategoryBreakdown({ buckets, currency }: CategoryBreakdownProps) {
  if (buckets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No expenses categorised yet.</p>
    );
  }

  return (
    <ul className="space-y-2">
      {buckets.map((b) => {
        const pct = Math.round(b.share * 100);
        return (
          <li key={b.category} className="space-y-1">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">{categoryLabel(b.category)}</span>
              <span className="tabular-nums text-muted-foreground">
                {formatMoney(b.total, currency)} <span className="text-xs">· {pct}%</span>
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary"
                style={{ width: `${Math.min(100, pct)}%` }}
                aria-hidden
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
