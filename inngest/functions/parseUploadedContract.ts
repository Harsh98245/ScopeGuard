/**
 * @file inngest/functions/parseUploadedContract.ts
 * @description Async parsing pipeline triggered by `contract/uploaded`. Runs
 *              the heavy work (Storage download, text extraction, Claude
 *              parseContract call) outside the upload request so the user
 *              gets immediate UI feedback while the verdict is being
 *              prepared.
 *
 *              Idempotency: if the contract row is already `parsedAt != null`
 *              when the function picks up the event, it short-circuits.
 *              Inngest auto-retries network/Claude failures with exponential
 *              backoff up to 3 attempts.
 */

import { NonRetriableError } from 'inngest';

import { parseContract } from '@/lib/ai';
import { extractContractText } from '@/lib/contracts/extract';
import { downloadContractBuffer } from '@/lib/contracts/storage';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/utils/logger';
import { inngest } from '@/inngest/client';

/**
 * Inngest function — listens for `contract/uploaded` and writes the parsed
 * structure back to the contracts row.
 */
export const parseUploadedContract = inngest.createFunction(
  {
    id: 'parse-uploaded-contract',
    name: 'Parse uploaded contract',
    retries: 3,
    // Single concurrency per contract — we never want two parses of the
    // same row racing.
    concurrency: { key: 'event.data.contractId', limit: 1 },
  },
  { event: 'contract/uploaded' },
  async ({ event, step }) => {
    const { userId, projectId, contractId } = event.data;

    // ---------- 1. Load the contract row ----------------------------------
    const contract = await step.run('load-contract', async () => {
      const row = await prisma.contract.findUnique({
        where: { id: contractId },
        include: { project: { select: { id: true, userId: true, name: true, clientName: true } } },
      });
      if (!row) throw new NonRetriableError(`Contract ${contractId} not found`);
      if (row.project.userId !== userId) {
        throw new NonRetriableError('Contract does not belong to event user');
      }
      return row;
    });

    if (contract.parsedAt) {
      logger.info('contract.parse.skipped_already_parsed', { contractId });
      return { skipped: true };
    }

    // ---------- 2. Download + extract text --------------------------------
    const rawText = await step.run('extract-text', async () => {
      const buffer = await downloadContractBuffer(contract.storageKey);
      const mime = mimeFromFileName(contract.fileName);
      return extractContractText(buffer, mime);
    });

    if (rawText.trim().length === 0) {
      throw new NonRetriableError(
        `Extracted text is empty for contract ${contractId}; document may be image-only.`,
      );
    }

    // Persist rawText so the user can read it even if parsing later fails.
    await step.run('save-raw-text', async () => {
      await prisma.contract.update({
        where: { id: contractId },
        data: { rawText },
      });
    });

    // ---------- 3. Run parseContract --------------------------------------
    const parsed = await step.run('claude-parse', async () => {
      return parseContract({
        contractText: rawText,
        projectContext: {
          name: contract.project.name,
          clientName: contract.project.clientName,
        },
      });
    });

    // ---------- 4. Save structured output ---------------------------------
    await step.run('save-parsed', async () => {
      await prisma.contract.update({
        where: { id: contractId },
        data: {
          deliverables: parsed.deliverables,
          exclusions: parsed.exclusions,
          ambiguousTerms: parsed.deliverables.filter((d) => d.isAmbiguous),
          paymentTerms: parsed.paymentTerms,
          overallRiskScore: parsed.overallRiskScore,
          parsedAt: new Date(),
        },
      });
    });

    return {
      contractId,
      projectId,
      deliverableCount: parsed.deliverables.length,
      exclusionCount: parsed.exclusions.length,
      overallRiskScore: parsed.overallRiskScore,
    };
  },
);

function mimeFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (lower.endsWith('.md')) return 'text/markdown';
  return 'text/plain';
}
