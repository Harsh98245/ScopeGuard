/**
 * @file components/scope/ScopeCheckForm.tsx
 * @description Client island for manually triggering a scope check without
 *              forwarding an actual email. Useful for testing contract coverage
 *              or demonstrating the feature to a client.
 *
 *              Posts to POST /api/scope/check synchronously (the AI call
 *              happens inline) and shows the verdict immediately on the same
 *              page. A "View in Inbox" link opens the full VerdictCard.
 */

'use client';

import { type CSSProperties, type FormEvent, useRef, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChangeOrderDraft } from '@/components/scope/ChangeOrderDraft';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProjectContext {
  id: string;
  name: string;
  clientEmail: string | null;
}

interface ScopeCheckApiResponse {
  id: string;
  verdict: 'IN_SCOPE' | 'OUT_OF_SCOPE' | 'AMBIGUOUS';
  confidence: number;
  citedClause: string | null;
  clauseReference: string | null;
  draftResponse: string | null;
  changeOrderText: string | null;
  estimatedHours: number | null;
}

type FormState = 'idle' | 'loading' | 'done' | 'error';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VERDICT_VARIANT = {
  IN_SCOPE: 'verdict-in-scope',
  OUT_OF_SCOPE: 'verdict-out-of-scope',
  AMBIGUOUS: 'verdict-ambiguous',
} as const;

const VERDICT_LABEL = {
  IN_SCOPE: 'In scope',
  OUT_OF_SCOPE: 'Out of scope',
  AMBIGUOUS: 'Ambiguous',
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ScopeCheckFormProps {
  project: ProjectContext;
}

/**
 * Form that accepts an email body + optional metadata, POSTs to
 * `/api/scope/check`, and renders the verdict inline. Requires the user to
 * be authenticated (the API route enforces this and returns 401 otherwise).
 *
 * @param props - See {@link ScopeCheckFormProps}.
 */
export function ScopeCheckForm({ project }: ScopeCheckFormProps) {
  const [state, setState] = useState<FormState>('idle');
  const [result, setResult] = useState<ScopeCheckApiResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === 'loading') return;

    const fd = new FormData(e.currentTarget);
    const emailBody = (fd.get('emailBody') as string).trim();
    const emailSubject = (fd.get('emailSubject') as string).trim() || undefined;
    const emailFromAddress = (fd.get('emailFromAddress') as string).trim() || undefined;

    if (!emailBody) return;

    setState('loading');
    setErrorMsg('');

    try {
      const res = await fetch('/api/scope/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, emailBody, emailSubject, emailFromAddress }),
      });

      const data = (await res.json()) as unknown;

      if (!res.ok) {
        const envelope = data as { error: { message: string } };
        setErrorMsg(envelope.error?.message ?? 'Scope check failed. Please try again.');
        setState('error');
        return;
      }

      setResult(data as ScopeCheckApiResponse);
      setState('done');
    } catch {
      setErrorMsg('Network error — please check your connection and try again.');
      setState('error');
    }
  }

  function handleReset() {
    setState('idle');
    setResult(null);
    setErrorMsg('');
    formRef.current?.reset();
  }

  return (
    <div className="space-y-6">
      {/* ---- Input form ---- */}
      <Card>
        <CardHeader>
          <CardTitle>Email content</CardTitle>
          <CardDescription>
            Paste the client email you want to check against the{' '}
            <span className="font-medium">{project.name}</span> contract.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="emailSubject">Subject (optional)</Label>
                <Input
                  id="emailSubject"
                  name="emailSubject"
                  placeholder="Re: logo revision"
                  disabled={state === 'loading'}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="emailFromAddress">From address (optional)</Label>
                <Input
                  id="emailFromAddress"
                  name="emailFromAddress"
                  type="email"
                  placeholder={project.clientEmail ?? 'client@example.com'}
                  disabled={state === 'loading'}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="emailBody">
                Email body <span className="text-destructive">*</span>
              </Label>
              <textarea
                id="emailBody"
                name="emailBody"
                required
                rows={8}
                placeholder="Hi, I was wondering if you could also add an animation to the homepage banner…"
                disabled={state === 'loading'}
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
              />
            </div>

            {state === 'error' && (
              <Alert variant="destructive">
                <p className="text-sm">{errorMsg}</p>
              </Alert>
            )}

            <div className="flex gap-2">
              <Button type="submit" disabled={state === 'loading'}>
                {state === 'loading' ? 'Checking… (AI may take ~10s)' : 'Check scope'}
              </Button>
              {(state === 'done' || state === 'error') && (
                <Button type="button" variant="outline" onClick={handleReset}>
                  Check another
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ---- Inline result ---- */}
      {state === 'done' && result !== null && (
        <Card className="border-l-4" style={verdictBorderStyle(result.verdict)}>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={VERDICT_VARIANT[result.verdict]}>
                {VERDICT_LABEL[result.verdict]}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {Math.round(result.confidence * 100)}% confidence
              </span>
              <a
                href="/inbox"
                className="ml-auto text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                View full card in Inbox →
              </a>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {result.citedClause && (
              <div className="rounded-md border-l-2 border-muted-foreground/40 bg-muted/50 px-3 py-2 space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cited clause{result.clauseReference ? ` · ${result.clauseReference}` : ''}
                </p>
                <p className="text-sm">{result.citedClause}</p>
              </div>
            )}
            {result.draftResponse && (
              <ChangeOrderDraft title="Drafted reply" text={result.draftResponse} />
            )}
            {result.changeOrderText && result.verdict !== 'IN_SCOPE' && (
              <ChangeOrderDraft title="Change order draft" text={result.changeOrderText} />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function verdictBorderStyle(verdict: 'IN_SCOPE' | 'OUT_OF_SCOPE' | 'AMBIGUOUS'): CSSProperties {
  const colors = {
    IN_SCOPE: 'hsl(var(--verdict-in-scope))',
    OUT_OF_SCOPE: 'hsl(var(--verdict-out-of-scope))',
    AMBIGUOUS: 'hsl(var(--verdict-ambiguous))',
  };
  return { borderLeftColor: colors[verdict] };
}
