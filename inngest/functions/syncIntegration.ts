/**
 * @file inngest/functions/syncIntegration.ts
 * @description Provider-agnostic sync function. Triggered by the
 *              `integration/connected` event (one-shot backfill on connect)
 *              AND fan-out from the `cron/sync-transactions.tick` event
 *              (hourly catch-up across all active integrations).
 *
 *              Steps:
 *                1. Resolve the IntegrationSource → driver via the registry.
 *                2. Pull the next page of NormalisedTransaction rows.
 *                3. Upsert each row by `(source, externalId)` — Prisma
 *                   guarantees idempotency via the unique constraint.
 *                4. Persist the new cursor onto Integration.metadata.
 *                5. Fan out `transaction/created` events for newly inserted
 *                   uncategorised expenses so the AI categoriser fills them in.
 *
 *              Idempotency: the upsert key is the unique pair, so retries
 *              never duplicate transactions. Concurrency is keyed on
 *              integrationId so two ticks for the same integration don't race.
 */

import { NonRetriableError } from 'inngest';
import type { Prisma } from '@prisma/client';

import { inngest } from '@/inngest/client';
import { getDriver } from '@/lib/integrations/registry';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/utils/logger';

export const syncIntegrationOnConnect = inngest.createFunction(
  {
    id: 'sync-integration-on-connect',
    name: 'Backfill new integration',
    retries: 3,
    concurrency: { key: 'event.data.integrationId', limit: 1 },
  },
  { event: 'integration/connected' },
  async ({ event, step }) => {
    const { integrationId } = event.data;

    const integration = await step.run('load-integration', async () => {
      const row = await prisma.integration.findUnique({ where: { id: integrationId } });
      if (!row) throw new NonRetriableError(`Integration ${integrationId} not found.`);
      if (!row.isActive) throw new NonRetriableError(`Integration ${integrationId} is inactive.`);
      return row;
    });

    const driver = getDriver(integration.source);
    if (!driver) {
      throw new NonRetriableError(`No driver registered for source ${integration.source}.`);
    }

    const { transactions, nextCursor } = await step.run('pull-transactions', async () => {
      return driver.syncTransactions(integration);
    });

    const result = await step.run('upsert-transactions', async () => {
      let inserted = 0;
      let unchanged = 0;
      for (const tx of transactions) {
        const upsert = await prisma.transaction.upsert({
          where: {
            source_externalId: { source: integration.source, externalId: tx.externalId },
          },
          create: {
            userId: integration.userId,
            source: integration.source,
            externalId: tx.externalId,
            type: tx.type,
            amount: tx.amount,
            currency: tx.currency,
            description: tx.description,
            occurredAt: tx.occurredAt,
          },
          update: {
            // Provider may correct an amount or description after a refund/edit.
            amount: tx.amount,
            description: tx.description,
          },
        });
        // Heuristic — Prisma upsert doesn't tell us "did this insert?" directly.
        // We compare createdAt to occurredAt as a rough proxy; for production
        // robustness this can graduate to a dedicated audit log.
        if (upsert.createdAt.getTime() === upsert.occurredAt.getTime()) inserted++;
        else unchanged++;
      }
      return { inserted, unchanged };
    });

    await step.run('save-cursor-and-timestamp', async () => {
      const meta = (integration.metadata ?? {}) as Prisma.JsonObject;
      await prisma.integration.update({
        where: { id: integration.id },
        data: {
          lastSyncedAt: new Date(),
          metadata: { ...meta, cursor: nextCursor ?? null },
        },
      });
    });

    // Fire one transaction/created event per inserted EXPENSE without a
    // category so the AI categoriser (lib/finances/categorize) takes over.
    await step.run('queue-categorisation', async () => {
      const expensesNeedingCategory = await prisma.transaction.findMany({
        where: {
          userId: integration.userId,
          source: integration.source,
          type: 'EXPENSE',
          category: null,
          externalId: { in: transactions.map((t) => t.externalId) },
        },
        select: { id: true },
      });
      if (expensesNeedingCategory.length === 0) return;
      await Promise.all(
        expensesNeedingCategory.map((row) =>
          inngest.send({
            name: 'transaction/created',
            data: { userId: integration.userId, transactionId: row.id },
          }),
        ),
      );
    });

    logger.info('integrations.synced', {
      integrationId,
      source: integration.source,
      pulled: transactions.length,
      inserted: result.inserted,
      unchanged: result.unchanged,
      nextCursor,
    });

    return {
      integrationId,
      pulled: transactions.length,
      inserted: result.inserted,
      nextCursor,
    };
  },
);

export const syncIntegrationsHourly = inngest.createFunction(
  {
    id: 'sync-integrations-hourly',
    name: 'Hourly integration sync',
    retries: 1,
  },
  { event: 'cron/sync-transactions.tick' },
  async ({ step }) => {
    const integrations = await step.run('list-active-integrations', async () => {
      return prisma.integration.findMany({
        where: { isActive: true },
        select: { id: true, userId: true, source: true },
      });
    });

    let total = 0;
    for (const integration of integrations) {
      // Each integration's sync runs as its own dispatched event so a slow
      // provider doesn't block the others. The dispatched event re-uses
      // syncIntegrationOnConnect's per-integration concurrency cap.
      await step.sendEvent(`fan-out-${integration.id}`, {
        name: 'integration/connected',
        data: { userId: integration.userId, integrationId: integration.id },
      });
      total++;
    }

    logger.info('integrations.cron.fanned_out', { count: total });
    return { fannedOut: total };
  },
);
