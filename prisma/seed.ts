/**
 * @file prisma/seed.ts
 * @description Idempotent seed script for local development. Creates one demo
 *              user with a project, a parsed contract, and a couple of scope
 *              checks plus realistic Stripe-sourced transactions. Safe to run
 *              repeatedly — uses upserts keyed off stable IDs.
 *
 * Run:
 *   pnpm prisma:seed
 *
 * Pre-requisites:
 *   - DATABASE_URL set to your local Supabase Postgres
 *   - The auth.users row for `demoUserId` already exists (or service-role
 *     bypass enabled). For full local parity, create the auth user first via
 *     the Supabase dashboard.
 */

import { PrismaClient, ScopeVerdict, TransactionType } from '@prisma/client';

const prisma = new PrismaClient();

// Stable IDs so reruns are idempotent.
const demoUserId = '00000000-0000-0000-0000-000000000001';
const demoProjectId = '00000000-0000-0000-0000-000000000010';
const demoContractId = '00000000-0000-0000-0000-000000000020';

async function main(): Promise<void> {
  console.warn('[seed] upserting demo user');
  const user = await prisma.user.upsert({
    where: { id: demoUserId },
    create: {
      id: demoUserId,
      email: 'demo@scopeguard.local',
      inboundEmailAlias: 'demo-abc123@inbound.scopeguard.app',
      timezone: 'America/Toronto',
      jurisdiction: 'US',
    },
    update: {},
  });

  console.warn('[seed] upserting demo project');
  await prisma.project.upsert({
    where: { id: demoProjectId },
    create: {
      id: demoProjectId,
      userId: user.id,
      name: 'Acme Marketing Site',
      clientName: 'Acme Corp',
      clientEmail: 'pm@acme.example',
      hourlyRate: '125.00',
      currency: 'USD',
    },
    update: {},
  });

  console.warn('[seed] upserting demo contract');
  await prisma.contract.upsert({
    where: { id: demoContractId },
    create: {
      id: demoContractId,
      projectId: demoProjectId,
      fileName: 'acme-msa-signed.pdf',
      storageKey: `${demoUserId}/${demoProjectId}/acme-msa-signed.pdf`,
      rawText:
        'MASTER SERVICES AGREEMENT\n\n2.1 Deliverables: Static marketing pages as specified in Appendix A.\n2.2 Exclusions: Authentication, dashboards, and payment integrations are out of scope.\n3.1 Revisions: Up to two rounds of revisions per page.',
      parsedAt: new Date(),
      deliverables: [
        {
          id: 'd1',
          clauseReference: '2.1',
          text: 'Static marketing pages as specified in Appendix A.',
          isAmbiguous: false,
        },
      ],
      exclusions: [
        { clauseReference: '2.2', text: 'Authentication, dashboards, and payment integrations.' },
      ],
      ambiguousTerms: [],
      paymentTerms: { amount: 8500, currency: 'USD', schedule: '50/50 milestone' },
      overallRiskScore: 3,
    },
    update: {},
  });

  console.warn('[seed] inserting scope checks (upsert by id)');
  await prisma.scopeCheck.upsert({
    where: { id: '00000000-0000-0000-0000-000000000030' },
    create: {
      id: '00000000-0000-0000-0000-000000000030',
      projectId: demoProjectId,
      contractId: demoContractId,
      rawEmailContent:
        'Hey — also can you add a customer login system before launch? Should be quick.',
      emailSubject: 'Quick add',
      emailFromAddress: 'pm@acme.example',
      verdict: ScopeVerdict.OUT_OF_SCOPE,
      confidence: 0.94,
      citedClause: 'Authentication, dashboards, and payment integrations are out of scope.',
      clauseReference: '§2.2',
      draftResponse:
        "Happy to help! Authentication is outside our current MSA (§2.2). I'll send a change order shortly.",
      changeOrderText: 'Change Order #1 — Customer login system: estimated 18 hours @ $125/hr…',
      estimatedHours: 18,
    },
    update: {},
  });

  console.warn('[seed] inserting demo transactions');
  const tx = [
    {
      externalId: 'ch_seed_001',
      type: TransactionType.INCOME,
      amount: '4250.00',
      description: 'Acme Corp — Milestone 1',
      occurredAt: new Date('2026-04-02T15:00:00Z'),
    },
    {
      externalId: 'ch_seed_002',
      type: TransactionType.EXPENSE,
      amount: '24.00',
      description: 'Figma subscription',
      category: 'Software',
      taxDeductible: true,
      occurredAt: new Date('2026-04-05T09:00:00Z'),
    },
  ];
  for (const t of tx) {
    await prisma.transaction.upsert({
      where: { source_externalId: { source: 'STRIPE', externalId: t.externalId } },
      create: {
        userId: user.id,
        source: 'STRIPE',
        currency: 'USD',
        ...t,
      },
      update: {},
    });
  }

  console.warn('[seed] done');
}

main()
  .catch((err) => {
    console.error('[seed] failed', err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
