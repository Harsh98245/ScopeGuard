/**
 * @file components/scope/VerdictCard.tsx
 * @description Server component that renders a single ScopeCheck as a full
 *              detail card. Sections:
 *                - Header: verdict badge, confidence pill, project link, date.
 *                - Email metadata: subject + from address.
 *                - Cited clause highlight (when the model found one).
 *                - Estimated hours (for OUT_OF_SCOPE with an hours estimate).
 *                - Drafted polite decline (ChangeOrderDraft island).
 *                - Change-order text (ChangeOrderDraft island).
 *                - UserActionForm island (hidden once userAction is recorded).
 *
 *              Client interactivity (copy buttons, action recording) is
 *              isolated in child client islands so the card itself stays a
 *              server component.
 */

import type { CSSProperties } from 'react';
import type { Prisma } from '@prisma/client';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
} from '@/components/ui/card';
import { ChangeOrderDraft } from '@/components/scope/ChangeOrderDraft';
import { UserActionForm } from '@/components/scope/UserActionForm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Scope check row with the owning project included. */
export type ScopeCheckRow = Prisma.ScopeCheckGetPayload<{
  include: { project: { select: { id: true; name: true; clientName: true } } };
}>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Verdict = 'IN_SCOPE' | 'OUT_OF_SCOPE' | 'AMBIGUOUS';

function verdictBadgeVariant(
  v: Verdict,
): 'verdict-in-scope' | 'verdict-out-of-scope' | 'verdict-ambiguous' {
  if (v === 'IN_SCOPE') return 'verdict-in-scope';
  if (v === 'OUT_OF_SCOPE') return 'verdict-out-of-scope';
  return 'verdict-ambiguous';
}

function verdictLabel(v: Verdict): string {
  if (v === 'IN_SCOPE') return 'In scope';
  if (v === 'OUT_OF_SCOPE') return 'Out of scope';
  return 'Ambiguous';
}

function verdictBorderStyle(v: Verdict): CSSProperties {
  const colors: Record<Verdict, string> = {
    IN_SCOPE: 'hsl(var(--verdict-in-scope))',
    OUT_OF_SCOPE: 'hsl(var(--verdict-out-of-scope))',
    AMBIGUOUS: 'hsl(var(--verdict-ambiguous))',
  };
  return { borderLeftColor: colors[v] };
}

function confidenceLabel(c: number): string {
  if (c >= 0.85) return 'High confidence';
  if (c >= 0.6) return 'Medium confidence';
  return 'Low confidence';
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const USER_ACTION_LABELS = {
  SENT_CHANGE_ORDER: 'Sent change order',
  ACCEPTED_ANYWAY: 'Accepted anyway',
  IGNORED: 'Ignored',
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface VerdictCardProps {
  check: ScopeCheckRow;
  /** When true, shows the project name link in the header (inbox view). */
  showProject?: boolean;
}

/**
 * Full-detail card for a single scope check verdict.
 *
 * @param props - See {@link VerdictCardProps}.
 */
export function VerdictCard({ check, showProject = false }: VerdictCardProps) {
  const verdict = check.verdict as Verdict;
  const confidencePct = Math.round(check.confidence * 100);

  return (
    <Card
      className="border-l-4 overflow-hidden"
      style={verdictBorderStyle(verdict)}
    >
      {/* ---- Header ---- */}
      <CardHeader className="pb-3 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={verdictBadgeVariant(verdict)}>
              {verdictLabel(verdict)}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {confidencePct}% · {confidenceLabel(check.confidence)}
            </span>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatDate(check.createdAt)}
          </span>
        </div>

        {showProject && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{check.project.name}</span>
            {' · '}
            {check.project.clientName}
          </p>
        )}

        {/* Email metadata */}
        <div className="text-sm space-y-0.5">
          {check.emailSubject && (
            <p>
              <span className="text-muted-foreground">Subject: </span>
              <span className="font-medium">{check.emailSubject}</span>
            </p>
          )}
          {check.emailFromAddress && (
            <p className="text-muted-foreground text-xs">From: {check.emailFromAddress}</p>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ---- Cited clause ---- */}
        {check.citedClause && (
          <div className="rounded-md border-l-2 border-muted-foreground/40 bg-muted/50 px-3 py-2 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Cited clause
              {check.clauseReference ? ` · ${check.clauseReference}` : ''}
            </p>
            <p className="text-sm leading-relaxed">{check.citedClause}</p>
          </div>
        )}

        {/* ---- Estimated hours (OUT_OF_SCOPE only) ---- */}
        {verdict === 'OUT_OF_SCOPE' && check.estimatedHours != null && (
          <p className="text-sm">
            <span className="text-muted-foreground">Estimated additional work: </span>
            <span className="font-medium">
              {check.estimatedHours} {check.estimatedHours === 1 ? 'hour' : 'hours'}
            </span>
          </p>
        )}

        {/* ---- Drafted reply ---- */}
        {check.draftResponse && (
          <ChangeOrderDraft title="Drafted reply" text={check.draftResponse} />
        )}

        {/* ---- Change-order text ---- */}
        {check.changeOrderText && verdict !== 'IN_SCOPE' && (
          <ChangeOrderDraft title="Change order draft" text={check.changeOrderText} />
        )}

        {/* ---- User action footer ---- */}
        <div className="pt-1">
          {check.userAction !== null ? (
            <p className="text-xs text-muted-foreground">
              Marked as:{' '}
              <span className="font-medium">
                {USER_ACTION_LABELS[check.userAction as keyof typeof USER_ACTION_LABELS]}
              </span>
            </p>
          ) : (
            <UserActionForm scopeCheckId={check.id} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
