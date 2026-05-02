/**
 * @file components/scope/ScopeLogTable.tsx
 * @description Server component that renders a compact table of ScopeCheck
 *              rows for a single project. Used on the project detail page to
 *              give a quick audit trail without expanding full VerdictCards.
 *
 *              Each row shows: date, verdict badge, confidence %, email
 *              subject, sender address, and the recorded user action (or a
 *              dash when none has been recorded yet).
 */

import Link from 'next/link';
import type { Prisma } from '@prisma/client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A scope check row with enough project info to build the project detail link. */
export type ScopeLogRow = Prisma.ScopeCheckGetPayload<{
  select: {
    id: true;
    verdict: true;
    confidence: true;
    emailSubject: true;
    emailFromAddress: true;
    userAction: true;
    createdAt: true;
    projectId: true;
  };
}>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Verdict = 'IN_SCOPE' | 'OUT_OF_SCOPE' | 'AMBIGUOUS';

const VERDICT_VARIANT: Record<
  Verdict,
  'verdict-in-scope' | 'verdict-out-of-scope' | 'verdict-ambiguous'
> = {
  IN_SCOPE: 'verdict-in-scope',
  OUT_OF_SCOPE: 'verdict-out-of-scope',
  AMBIGUOUS: 'verdict-ambiguous',
};

const VERDICT_LABEL: Record<Verdict, string> = {
  IN_SCOPE: 'In scope',
  OUT_OF_SCOPE: 'Out of scope',
  AMBIGUOUS: 'Ambiguous',
};

const USER_ACTION_LABEL: Record<string, string> = {
  SENT_CHANGE_ORDER: 'Sent CO',
  ACCEPTED_ANYWAY: 'Accepted',
  IGNORED: 'Ignored',
};

function formatShortDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ScopeLogTableProps {
  checks: ScopeLogRow[];
  /** Project ID used to build the "run manual check" link. */
  projectId: string;
  /** Maximum rows to display (surplus rows are hidden). Defaults to 10. */
  limit?: number;
}

/**
 * Compact, scrollable table of recent scope checks for a project.
 * Shows up to `limit` rows and provides a link to the full inbox feed.
 *
 * @param props - See {@link ScopeLogTableProps}.
 */
export function ScopeLogTable({ checks, projectId, limit = 10 }: ScopeLogTableProps) {
  const visible = checks.slice(0, limit);
  const hasMore = checks.length > limit;

  if (visible.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center">
        <p className="text-sm text-muted-foreground">No scope checks yet.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Forward a client email to your inbound alias, or{' '}
          <Link
            href={`/projects/${projectId}/scope-check`}
            className="underline underline-offset-2 hover:text-foreground"
          >
            run a manual check
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Date</th>
              <th className="px-3 py-2 text-left font-medium">Verdict</th>
              <th className="px-3 py-2 text-left font-medium">Conf.</th>
              <th className="px-3 py-2 text-left font-medium">Subject</th>
              <th className="px-3 py-2 text-left font-medium">From</th>
              <th className="px-3 py-2 text-left font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((check, i) => {
              const verdict = check.verdict as Verdict;
              return (
                <tr
                  key={check.id}
                  className={cn(
                    'border-b last:border-0 transition-colors hover:bg-muted/30',
                    i % 2 === 0 ? '' : 'bg-muted/10',
                  )}
                >
                  <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                    {formatShortDate(check.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={VERDICT_VARIANT[verdict]} className="text-xs">
                      {VERDICT_LABEL[verdict]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {Math.round(check.confidence * 100)}%
                  </td>
                  <td className="px-3 py-2 max-w-[200px] truncate text-muted-foreground">
                    {check.emailSubject ?? <span className="italic">—</span>}
                  </td>
                  <td className="px-3 py-2 max-w-[150px] truncate text-muted-foreground text-xs">
                    {check.emailFromAddress ?? <span className="italic">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {check.userAction
                      ? USER_ACTION_LABEL[check.userAction] ?? check.userAction
                      : <span className="italic">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        {hasMore && (
          <Link href="/inbox" className="underline underline-offset-2 hover:text-foreground">
            View all {checks.length} checks in Inbox →
          </Link>
        )}
        <Link
          href={`/projects/${projectId}/scope-check`}
          className="ml-auto underline underline-offset-2 hover:text-foreground"
        >
          Run manual check →
        </Link>
      </div>
    </div>
  );
}
