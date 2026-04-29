/**
 * @file inngest/functions/processInboundEmail.ts
 * @description The scope-check pipeline kicked off by every Postmark inbound
 *              webhook. Steps:
 *                1. Look up the User by inboundEmailAlias.
 *                2. Find the Project owned by that user that matches the
 *                   sender. When no project matches, save the orphan email
 *                   (TODO: surface in /inbox once the inbox UI lands) and
 *                   bail without a verdict.
 *                3. Load the latest Contract for that project. If parsedAt
 *                   is null, wait for `contract/parsed` matching the
 *                   contractId (timeout 15 minutes — emails arriving before
 *                   parsing usually resolve in seconds, but a 15-minute
 *                   ceiling protects us from waiting forever on a doc that
 *                   silently failed).
 *                4. Run lib/ai checkScope.
 *                5. Persist the ScopeCheck row.
 *                6. Emit `scope/check.completed` so notifyUserOfVerdict
 *                   can fan out the email + realtime notifications.
 *
 *              Idempotency: Inngest dedupes incoming events on
 *              `event.data.postmarkMessageId`, so retried Postmark webhooks
 *              never double-process. Every `step.run` block is also
 *              memoised by Inngest's step engine.
 */

import { NonRetriableError } from 'inngest';

import { checkScope } from '@/lib/ai';
import type { ParsedContract } from '@/lib/ai/types';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/utils/logger';
import { inngest } from '@/inngest/client';

/** How long to wait for `contract/parsed` before giving up and producing
 *  an AMBIGUOUS verdict. Long enough to absorb a slow first parse, short
 *  enough that a stuck email doesn't sit in Inngest forever. */
const PARSE_WAIT_TIMEOUT = '15m';

export const processInboundEmail = inngest.createFunction(
  {
    id: 'process-inbound-email',
    name: 'Process inbound email',
    retries: 3,
    // Postmark may resend the same MessageID on its own retries; dedupe.
    idempotency: 'event.data.postmarkMessageId',
  },
  { event: 'scope/email.received' },
  async ({ event, step }) => {
    const { postmarkMessageId, toAlias, fromEmail, subject, bodyText } = event.data;

    logger.info('inbound.received', { postmarkMessageId, toAlias, fromEmail });

    if (bodyText.trim().length === 0) {
      // Empty body — nothing for the model to evaluate. Don't retry.
      throw new NonRetriableError('Inbound email body is empty.');
    }

    // ---------- 1. User by alias -----------------------------------------
    const user = await step.run('lookup-user', async () => {
      const u = await prisma.user.findUnique({ where: { inboundEmailAlias: toAlias } });
      if (!u) {
        // Unknown alias — most likely a typo or a deleted account. Don't
        // retry; just log and exit.
        throw new NonRetriableError(`No user with inbound alias ${toAlias}`);
      }
      return u;
    });

    // ---------- 2. Match a project by client email ------------------------
    const project = await step.run('match-project', async () => {
      // Exact-match the sender's email against project.clientEmail. Most
      // freelancers have one project per client so this is correct most
      // of the time; the few-projects-per-client fallback (latest active)
      // is documented behaviour.
      const exact = await prisma.project.findFirst({
        where: { userId: user.id, status: 'ACTIVE', clientEmail: fromEmail },
        orderBy: { createdAt: 'desc' },
      });
      if (exact) return exact;

      const fallback = await prisma.project.findFirst({
        where: { userId: user.id, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      });
      return fallback;
    });

    if (!project) {
      // No project at all yet — record nothing; the user will see the
      // missed email in their /inbox once that surface lands.
      logger.info('inbound.skipped_no_project', {
        userId: user.id,
        postmarkMessageId,
        fromEmail,
      });
      return { skipped: true, reason: 'no-project' };
    }

    // ---------- 3. Load latest contract; wait for parse if needed ---------
    let contract = await step.run('load-contract', async () => {
      return prisma.contract.findFirst({
        where: { projectId: project.id },
        orderBy: { createdAt: 'desc' },
      });
    });

    if (contract && !contract.parsedAt) {
      // Wait for parseUploadedContract to finish for THIS contract.
      const parsedEvent = await step.waitForEvent('wait-for-parse', {
        event: 'contract/parsed',
        timeout: PARSE_WAIT_TIMEOUT,
        if: `event.data.contractId == "${contract.id}"`,
      });

      if (!parsedEvent) {
        // Timed out — let the model decide on AMBIGUOUS with a generic
        // skeleton ParsedContract. Better than blocking the user forever.
        logger.warn('inbound.parse_wait_timeout', {
          contractId: contract.id,
          projectId: project.id,
          postmarkMessageId,
        });
      } else {
        // Re-fetch so we read parsedAt + structured output written by the
        // save-parsed step in parseUploadedContract.
        contract = await step.run('reload-contract', async () => {
          return prisma.contract.findFirst({
            where: { id: contract!.id },
          });
        });
      }
    }

    // ---------- 4. Run checkScope ----------------------------------------
    const result = await step.run('check-scope', async () => {
      const parsed: ParsedContract = contract?.parsedAt
        ? rebuildParsedContract(contract)
        : skeletonParsedContract();

      return checkScope({
        emailContent: bodyText,
        emailSubject: subject || undefined,
        parsedContract: parsed,
        projectContext: {
          name: project.name,
          clientName: project.clientName,
          ...(project.hourlyRate ? { hourlyRate: project.hourlyRate.toString() } : {}),
          currency: project.currency,
        },
      });
    });

    // ---------- 5. Persist ScopeCheck row --------------------------------
    const scopeCheck = await step.run('save-scope-check', async () => {
      return prisma.scopeCheck.create({
        data: {
          projectId: project.id,
          contractId: contract?.id ?? null,
          rawEmailContent: bodyText,
          emailSubject: subject || null,
          emailFromAddress: fromEmail,
          verdict: result.verdict,
          confidence: result.confidence,
          citedClause: result.citedClause,
          clauseReference: result.clauseReference,
          draftResponse: result.draftPoliteDecline,
          changeOrderText: result.draftChangeOrder,
          estimatedHours: result.estimatedAdditionalHours ?? null,
        },
      });
    });

    // ---------- 6. Notify --------------------------------------------------
    await step.sendEvent('emit-check-completed', {
      name: 'scope/check.completed',
      data: {
        userId: user.id,
        projectId: project.id,
        scopeCheckId: scopeCheck.id,
        verdict: scopeCheck.verdict,
        confidence: scopeCheck.confidence,
      },
    });

    logger.info('inbound.completed', {
      postmarkMessageId,
      userId: user.id,
      projectId: project.id,
      scopeCheckId: scopeCheck.id,
      verdict: scopeCheck.verdict,
      confidence: scopeCheck.confidence,
    });

    return {
      scopeCheckId: scopeCheck.id,
      verdict: scopeCheck.verdict,
    };
  },
);

/**
 * Rebuild a ParsedContract object from a Contract row that has already
 * been parsed (parsedAt != null). The columns are Prisma JSON values, so
 * we cast through `unknown` after asserting parsedAt.
 */
function rebuildParsedContract(contract: {
  deliverables: unknown;
  exclusions: unknown;
  paymentTerms: unknown;
  overallRiskScore: number | null;
}): ParsedContract {
  return {
    deliverables: (contract.deliverables ?? []) as ParsedContract['deliverables'],
    exclusions: (contract.exclusions ?? []) as ParsedContract['exclusions'],
    paymentTerms: (contract.paymentTerms ?? {}) as ParsedContract['paymentTerms'],
    overallRiskScore: contract.overallRiskScore ?? 5,
    riskFlags: [],
  };
}

/** Generic empty contract used when no parse is available — the model will
 *  reasonably emit AMBIGUOUS in this state. */
function skeletonParsedContract(): ParsedContract {
  return {
    deliverables: [],
    exclusions: [],
    paymentTerms: {},
    overallRiskScore: 5,
    riskFlags: ['No parsed contract available — verdict will be AMBIGUOUS by default.'],
  };
}
