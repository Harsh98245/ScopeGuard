/**
 * @file tests/e2e/fixtures/seed.ts
 * @description Per-spec data seeders. Each helper returns the row(s) it
 *              created so specs can assert against IDs directly. All seeders
 *              use the service-role Supabase REST API (not Prisma) so the
 *              suite runs without a Node-side Prisma client — Playwright
 *              tests run in their own process pool.
 *
 *              Cleanup: prefer `deleteTestUser(userId)` over per-row deletes —
 *              the schema cascades on user deletion so a single call wipes
 *              every owned project, contract, scope check, and transaction.
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

function admin() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    throw new Error('E2E seed helpers require Supabase admin credentials.');
  }
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface SeedProjectInput {
  userId: string;
  name?: string;
  clientName?: string;
  clientEmail?: string | null;
  hourlyRate?: string | null;
  currency?: string;
}

export async function seedProject(input: SeedProjectInput): Promise<{ id: string }> {
  const { data, error } = await admin()
    .from('projects')
    .insert({
      userId: input.userId,
      name: input.name ?? 'E2E Test Project',
      clientName: input.clientName ?? 'Acme Corp',
      clientEmail: input.clientEmail ?? null,
      hourlyRate: input.hourlyRate ?? null,
      currency: input.currency ?? 'USD',
    })
    .select('id')
    .single();
  if (error) throw error;
  return { id: data.id as string };
}

// ---------------------------------------------------------------------------
// Scope checks
// ---------------------------------------------------------------------------

export interface SeedScopeCheckInput {
  projectId: string;
  verdict?: 'IN_SCOPE' | 'OUT_OF_SCOPE' | 'AMBIGUOUS';
  emailSubject?: string;
  emailFromAddress?: string;
}

export async function seedScopeCheck(input: SeedScopeCheckInput): Promise<{ id: string }> {
  const { data, error } = await admin()
    .from('scope_checks')
    .insert({
      projectId: input.projectId,
      verdict: input.verdict ?? 'IN_SCOPE',
      confidence: 0.9,
      rawEmailContent: 'Hi — can you add an animation to the homepage?',
      emailSubject: input.emailSubject ?? 'Quick request',
      emailFromAddress: input.emailFromAddress ?? 'client@example.com',
      citedClause: 'Section 2.1 — Deliverables',
      clauseReference: 'Section 2.1',
      draftResponse: 'Thanks for the note — happy to help.',
      changeOrderText: 'Change order for additional animation work.',
      estimatedHours: 4,
    })
    .select('id')
    .single();
  if (error) throw error;
  return { id: data.id as string };
}

// ---------------------------------------------------------------------------
// Transactions (Financial OS)
// ---------------------------------------------------------------------------

export interface SeedTransactionInput {
  userId: string;
  type?: 'INCOME' | 'EXPENSE';
  amount?: string;
  currency?: string;
  description?: string;
  category?: string | null;
  taxDeductible?: boolean;
  occurredAt?: Date;
  source?: 'STRIPE' | 'PAYPAL' | 'PLAID';
}

export async function seedTransaction(
  input: SeedTransactionInput,
): Promise<{ id: string }> {
  const { data, error } = await admin()
    .from('transactions')
    .insert({
      userId: input.userId,
      source: input.source ?? 'STRIPE',
      externalId: `e2e:${crypto.randomUUID()}`,
      type: input.type ?? 'INCOME',
      amount: input.amount ?? '1000.00',
      currency: input.currency ?? 'USD',
      description: input.description ?? 'E2E seed transaction',
      category: input.category ?? null,
      taxDeductible: input.taxDeductible ?? false,
      occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    })
    .select('id')
    .single();
  if (error) throw error;
  return { id: data.id as string };
}
