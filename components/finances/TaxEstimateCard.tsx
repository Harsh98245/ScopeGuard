/**
 * @file components/finances/TaxEstimateCard.tsx
 * @description Server component rendering a tax estimate result. Shows the
 *              quarterly suggested set-aside as the headline figure with the
 *              annual breakdown immediately below.
 *
 *              The disclaimer banner is REQUIRED — these are guidance
 *              numbers, not tax advice.
 */

import type { TaxEstimateResult } from '@/lib/finances/tax/types';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatMoney } from '@/lib/utils/currency';

interface TaxEstimateCardProps {
  estimate: TaxEstimateResult;
  yearToDate: {
    income: string;
    deductibleExpenses: string;
    net: string;
  };
  projectedAnnualNet: string;
}

export function TaxEstimateCard({
  estimate,
  yearToDate,
  projectedAnnualNet,
}: TaxEstimateCardProps) {
  const effectivePct = (estimate.effectiveRate * 100).toFixed(1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Quarterly tax set-aside
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs uppercase tracking-wider text-secondary-foreground">
            {estimate.jurisdiction}
          </span>
        </CardTitle>
        <CardDescription>
          Based on YTD activity, projected to a full year, taxed at{' '}
          {estimate.jurisdiction} {estimate.currency} brackets.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-3xl font-bold tabular-nums">
            {formatMoney(estimate.estimatedQuarterly, estimate.currency)}
          </p>
          <p className="text-xs text-muted-foreground">
            per quarter · {formatMoney(estimate.estimatedAnnualTax, estimate.currency)}{' '}
            for the full year ({effectivePct}% effective)
          </p>
        </div>

        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <Detail label="YTD income" value={formatMoney(yearToDate.income, estimate.currency)} />
          <Detail
            label="YTD deductible expenses"
            value={formatMoney(yearToDate.deductibleExpenses, estimate.currency)}
          />
          <Detail label="YTD net" value={formatMoney(yearToDate.net, estimate.currency)} />
          <Detail
            label="Projected annual net"
            value={formatMoney(projectedAnnualNet, estimate.currency)}
          />
        </div>

        <div className="space-y-2 border-t pt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Breakdown
          </p>
          <ul className="space-y-1 text-sm">
            {estimate.lineItems.map((line) => (
              <li key={line.label} className="flex items-baseline justify-between gap-3">
                <span>
                  {line.label}
                  {line.description && (
                    <span className="ml-1 text-xs text-muted-foreground">· {line.description}</span>
                  )}
                </span>
                <span className="tabular-nums font-medium">
                  {formatMoney(line.amount, estimate.currency)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">Disclaimer</p>
          <p>
            This is a back-of-envelope estimate, not tax advice. Talk to an
            accountant before filing.
          </p>
          {estimate.notes.map((note, i) => (
            <p key={i}>{note}</p>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}
