/**
 * @file components/scope/ContractClauseViewer.tsx
 * @description Renders a parsed contract: deliverables (with ambiguous
 *              flags + reasons), explicit exclusions, and payment terms.
 *              Pure presentational — receives already-parsed JSON from the
 *              server component.
 *
 *              The shape matches lib/ai/types.ParsedContract, but we accept
 *              a loose `unknown[]` here because the parent reads from
 *              Prisma's Json columns which arrive as `Prisma.JsonValue`.
 */

import { Badge } from '@/components/ui/badge';

interface Deliverable {
  id: string;
  clauseReference: string;
  text: string;
  isAmbiguous: boolean;
  ambiguityReason?: string;
}

interface Exclusion {
  clauseReference: string;
  text: string;
}

interface PaymentTerms {
  amount?: number;
  currency?: string;
  schedule?: string;
  lateFeeClause?: string;
}

export interface ContractClauseViewerProps {
  /** ISO timestamp when the contract was parsed; null while pending. */
  parsedAt: string | null;
  /** Parsed deliverables. Any[] because Prisma JSON is loose at the type level. */
  deliverables: unknown[];
  /** Parsed explicit exclusions. */
  exclusions: unknown[];
  /** Parsed payment terms. */
  paymentTerms: unknown;
}

export function ContractClauseViewer({
  parsedAt,
  deliverables,
  exclusions,
  paymentTerms,
}: ContractClauseViewerProps) {
  if (!parsedAt) {
    return (
      <p className="text-sm text-muted-foreground">
        Parsing in progress. Refresh in a few seconds — Claude usually finishes within a minute.
      </p>
    );
  }

  const ds = (deliverables as Deliverable[]) ?? [];
  const xs = (exclusions as Exclusion[]) ?? [];
  const pt = (paymentTerms as PaymentTerms | null) ?? null;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Deliverables ({ds.length})
        </h3>
        {ds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deliverables extracted.</p>
        ) : (
          <ul className="space-y-3">
            {ds.map((d) => (
              <li key={d.id} className="rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {d.clauseReference}
                  </p>
                  {d.isAmbiguous ? <Badge variant="destructive">Ambiguous</Badge> : null}
                </div>
                <p className="mt-1 text-sm">{d.text}</p>
                {d.isAmbiguous && d.ambiguityReason ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Why ambiguous:</span>{' '}
                    {d.ambiguityReason}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Explicit exclusions ({xs.length})
        </h3>
        {xs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No explicit exclusions — absence is NOT exclusion. Anything not listed under
            deliverables will surface as AMBIGUOUS in scope checks.
          </p>
        ) : (
          <ul className="space-y-2">
            {xs.map((x, i) => (
              <li key={`${x.clauseReference}-${i}`} className="rounded-md border border-border p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {x.clauseReference}
                </p>
                <p className="mt-1 text-sm">{x.text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pt ? (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Payment terms
          </h3>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {pt.amount !== undefined ? (
              <Pair label="Amount" value={`${pt.amount} ${pt.currency ?? ''}`.trim()} />
            ) : null}
            {pt.schedule ? <Pair label="Schedule" value={pt.schedule} /> : null}
            {pt.lateFeeClause ? <Pair label="Late fee" value={pt.lateFeeClause} /> : null}
          </dl>
        </section>
      ) : null}
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
