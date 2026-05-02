/**
 * @file inngest/functions/categorizeTransaction.ts
 * @description AI-driven category enrichment for newly-created expense
 *              transactions. Triggered by `transaction/created` from the
 *              transactions API route when the user did not supply a category.
 *
 *              Steps:
 *                1. Load the transaction; bail (NonRetriable) if it's missing,
 *                   not an EXPENSE, or already has a category set (idempotent).
 *                2. Call `categorizeExpense` (Claude tool_use, 3 retries).
 *                3. Persist the category + taxDeductible recommendation onto
 *                   the row.
 *
 *              Concurrency is keyed on `transactionId` so a stuck event never
 *              blocks unrelated transactions. Idempotency is via the
 *              "already-categorised" short-circuit inside step 1.
 */

import { NonRetriableError } from 'inngest';

import { inngest } from '@/inngest/client';
import { categorizeExpense } from '@/lib/finances/categorize';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/utils/logger';

export const categorizeTransaction = inngest.createFunction(
  {
    id: 'categorize-transaction',
    name: 'Categorise transaction',
    retries: 3,
    concurrency: { key: 'event.data.transactionId', limit: 1 },
  },
  { event: 'transaction/created' },
  async ({ event, step }) => {
    const { userId, transactionId } = event.data;

    const tx = await step.run('load-transaction', async () => {
      const row = await prisma.transaction.findFirst({
        where: { id: transactionId, userId },
      });
      if (!row) {
        throw new NonRetriableError(`Transaction ${transactionId} not found.`);
      }
      return row;
    });

    if (tx.type !== 'EXPENSE') {
      logger.info('finances.categorize.skipped_non_expense', {
        userId,
        transactionId,
        type: tx.type,
      });
      return { skipped: true, reason: 'non-expense' };
    }

    if (tx.category !== null) {
      // User-supplied category or a previous run already filled it in. No-op.
      logger.info('finances.categorize.skipped_already_set', {
        userId,
        transactionId,
        category: tx.category,
      });
      return { skipped: true, reason: 'already-set' };
    }

    const result = await step.run('claude-categorise', async () => {
      return categorizeExpense({
        description: tx.description ?? 'Unknown',
        amount: tx.amount.toString(),
        currency: tx.currency,
      });
    });

    await step.run('save-category', async () => {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          category: result.category,
          // Only seed taxDeductible from the AI when the user hasn't already
          // explicitly flipped it on. The default in the Prisma schema is
          // `false`, so we know `false` here means "not set by the user yet".
          taxDeductible: tx.taxDeductible || result.taxDeductible,
        },
      });
    });

    logger.info('finances.categorize.completed', {
      userId,
      transactionId,
      category: result.category,
      confidence: result.confidence,
    });

    return {
      category: result.category,
      confidence: result.confidence,
    };
  },
);
