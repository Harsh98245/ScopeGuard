/**
 * @file lib/ai/checkScope.ts
 * @description Decides whether a client's email request falls within the
 *              agreed contract scope. Returns a structured verdict with a
 *              cited clause, a polite-decline draft, and a change-order draft.
 *
 *              Implementation invariants (see ADR-003):
 *                - Always uses Claude tool_use with a strict input_schema.
 *                - The contract context block is marked `cache_control:
 *                  ephemeral` so back-to-back checks against the same
 *                  contract hit Anthropic's prompt cache.
 *                - On schema validation failure, retries up to MAX_ATTEMPTS
 *                  with a re-prompt that includes the validation errors.
 *                - Throws ScopeCheckError when retries are exhausted.
 *                - Logs `ai.checkScope.completed` with token usage on success.
 */

import 'server-only';

import { z } from 'zod';

import { callTool } from '@/lib/ai/client';
import { ScopeCheckError } from '@/lib/ai/errors';
import { ScopeCheckResultJsonSchema, ScopeCheckResultSchema } from '@/lib/ai/schemas';
import type { ParsedContract, ProjectContext, ScopeCheckResult } from '@/lib/ai/types';
import { logger } from '@/lib/utils/logger';

const MAX_ATTEMPTS = 3;
const EMAIL_HARD_LIMIT = 40_000;
const TOOL_NAME = 'record_scope_verdict';

const SYSTEM_PROMPT = `You are a contract enforcement specialist. You will be given:

1. A parsed contract (deliverables, exclusions, payment terms, revision policy).
2. A single client email.

Your job: decide whether the email's request falls within the scope of the contract.

Rules of judgment:
- If the request is covered by an existing deliverable, verdict = IN_SCOPE.
- If the request matches an explicit exclusion, OR is clearly outside any deliverable, verdict = OUT_OF_SCOPE.
- If the contract does not clearly resolve, verdict = AMBIGUOUS.

When you cite a clause, use the exact clauseReference and verbatim text from the parsed contract — do not paraphrase. If no clause is on point, leave citedClause and clauseReference null.

Confidence guidance:
- 0.85+ requires a specific clause that directly resolves the question.
- 0.6-0.85 = strong inference but not bulletproof.
- <0.6 = genuine uncertainty; prefer AMBIGUOUS in that case.

Always provide both draftPoliteDecline and draftChangeOrder, even when verdict = IN_SCOPE — the user may still find them useful as templates. Sign emails with "[Your name]" rather than guessing the freelancer's name.

You MUST emit your answer by calling the record_scope_verdict tool exactly once. Do not add any conversational text.`;

export interface CheckScopeInput {
  /** Plain-text body of the client's email (subject can be appended). */
  emailContent: string;
  /** The project's parsed contract (output of parseContract). */
  parsedContract: ParsedContract;
  /** Project context — used for change-order drafting. */
  projectContext?: ProjectContext;
  /** Optional email subject — included in the prompt for context. */
  emailSubject?: string;
}

/**
 * Check a client email against a parsed contract and return a structured verdict.
 *
 * @param input - Email content + parsed contract + project context.
 * @returns A {@link ScopeCheckResult} validated against {@link ScopeCheckResultSchema}.
 * @throws {@link ScopeCheckError} when the model fails to return a valid
 *         structured payload after {@link MAX_ATTEMPTS} attempts.
 *
 * @example
 *   const result = await checkScope({
 *     emailContent: forwardedEmail.body,
 *     emailSubject: forwardedEmail.subject,
 *     parsedContract: contract.deliverables ? (contract as any) : await parseContract(...),
 *     projectContext: { hourlyRate: 125, currency: 'USD', clientName: 'Acme Corp' },
 *   });
 *   await prisma.scopeCheck.create({ data: { ...result, projectId, ... } });
 */
export async function checkScope(input: CheckScopeInput): Promise<ScopeCheckResult> {
  const email = input.emailContent.trim();
  if (email.length === 0) {
    throw new ScopeCheckError('Email content is empty.', 0);
  }
  if (email.length > EMAIL_HARD_LIMIT) {
    throw new ScopeCheckError(
      `Email content exceeds ${EMAIL_HARD_LIMIT} chars; truncate before calling checkScope.`,
      0,
    );
  }

  const tool = {
    name: TOOL_NAME,
    description:
      'Record the verdict, cited clause, and drafted responses. Must be called exactly once.',
    input_schema: ScopeCheckResultJsonSchema,
  } as const;

  const contractContext = formatContractContext(input.parsedContract, input.projectContext);
  const emailBlock = formatEmailBlock(email, input.emailSubject);

  let lastValidationError: z.ZodError | null = null;
  let lastRawInput: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Two text blocks: the contract context (cached after the first call
    // to this contract) and the per-call email payload (never cached).
    // On retry attempts we prepend a third text block describing the prior
    // validation issue.
    const userBlocks: Array<{
      type: 'text';
      text: string;
      cache_control?: { type: 'ephemeral' };
    }> = [];

    if (attempt > 1) {
      userBlocks.push({ type: 'text', text: retryGuidance(lastValidationError, lastRawInput) });
    }

    userBlocks.push({
      type: 'text',
      text: contractContext,
      cache_control: { type: 'ephemeral' },
    });
    userBlocks.push({ type: 'text', text: emailBlock });

    const startedAt = Date.now();
    let raw: unknown;
    try {
      const result = await callTool({
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: userBlocks as unknown as Parameters<typeof callTool>[0]['messages'][number]['content'],
          },
        ],
        tools: [tool as unknown as Parameters<typeof callTool>[0]['tools'][number]],
        toolName: TOOL_NAME,
        maxTokens: 4096,
      });
      raw = result.input;

      const parsed = ScopeCheckResultSchema.safeParse(raw);
      if (parsed.success) {
        logger.info('ai.checkScope.completed', {
          attempt,
          latencyMs: Date.now() - startedAt,
          inputTokens: result.usage.input_tokens,
          outputTokens: result.usage.output_tokens,
          // SDK exposes cache stats on usage when caching is in play.
          cacheReadTokens: (result.usage as unknown as { cache_read_input_tokens?: number })
            .cache_read_input_tokens,
          verdict: parsed.data.verdict,
          confidence: parsed.data.confidence,
        });
        return parsed.data;
      }

      lastValidationError = parsed.error;
      lastRawInput = raw;
      logger.warn('ai.checkScope.invalid_payload', {
        attempt,
        issues: parsed.error.issues.slice(0, 5).map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    } catch (err) {
      throw new ScopeCheckError(
        `checkScope failed on attempt ${attempt}: ${err instanceof Error ? err.message : String(err)}`,
        attempt,
        err,
      );
    }
  }

  throw new ScopeCheckError(
    `checkScope exhausted ${MAX_ATTEMPTS} attempts without a schema-valid payload.`,
    MAX_ATTEMPTS,
    lastValidationError ?? undefined,
  );
}

/**
 * Render the parsed-contract object into a deterministic plain-text block.
 * Determinism matters: identical inputs produce identical bytes, which is
 * what enables Anthropic's prompt cache to hit between calls.
 */
function formatContractContext(parsed: ParsedContract, ctx?: ProjectContext): string {
  const lines: string[] = [];
  lines.push('=== CONTRACT CONTEXT ===');
  lines.push('');

  if (ctx) {
    lines.push('Project:');
    if (ctx.name) lines.push(`  - Name: ${ctx.name}`);
    if (ctx.clientName) lines.push(`  - Client: ${ctx.clientName}`);
    if (ctx.hourlyRate !== undefined) {
      lines.push(`  - Hourly rate: ${ctx.hourlyRate} ${ctx.currency ?? ''}`.trim());
    }
    lines.push('');
  }

  lines.push('Deliverables:');
  if (parsed.deliverables.length === 0) {
    lines.push('  (none recorded)');
  } else {
    for (const d of parsed.deliverables) {
      const flag = d.isAmbiguous ? ' [AMBIGUOUS]' : '';
      lines.push(`  - ${d.id} (${d.clauseReference})${flag}: ${d.text}`);
      if (d.isAmbiguous && d.ambiguityReason) {
        lines.push(`      reason: ${d.ambiguityReason}`);
      }
    }
  }
  lines.push('');

  lines.push('Explicit exclusions:');
  if (parsed.exclusions.length === 0) {
    lines.push('  (none recorded — absence is NOT exclusion)');
  } else {
    for (const e of parsed.exclusions) {
      lines.push(`  - ${e.clauseReference}: ${e.text}`);
    }
  }
  lines.push('');

  if (parsed.revisionPolicy) {
    lines.push(`Revision policy: ${parsed.revisionPolicy}`);
    lines.push('');
  }

  lines.push(`Overall risk score (1-10): ${parsed.overallRiskScore}`);
  if (parsed.riskFlags.length > 0) {
    lines.push('Risk flags:');
    for (const flag of parsed.riskFlags) lines.push(`  - ${flag}`);
  }
  lines.push('=== END CONTRACT CONTEXT ===');
  return lines.join('\n');
}

function formatEmailBlock(body: string, subject?: string): string {
  const lines: string[] = ['=== CLIENT EMAIL ==='];
  if (subject) lines.push(`Subject: ${subject}`);
  lines.push('Body:');
  lines.push(body);
  lines.push('=== END CLIENT EMAIL ===');
  lines.push('');
  lines.push(
    'Decide IN_SCOPE / OUT_OF_SCOPE / AMBIGUOUS for the request in this email and call record_scope_verdict.',
  );
  return lines.join('\n');
}

function retryGuidance(zodErr: z.ZodError | null, prior: unknown): string {
  const issuesSummary = zodErr
    ? zodErr.issues
        .slice(0, 8)
        .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n')
    : '- (no validation issues captured)';

  const priorJson = (() => {
    try {
      return JSON.stringify(prior).slice(0, 1500);
    } catch {
      return '(prior payload not serialisable)';
    }
  })();

  return [
    'Your previous record_scope_verdict call did not match the required schema.',
    '',
    'Validation issues:',
    issuesSummary,
    '',
    `Your previous payload (truncated): ${priorJson}`,
    '',
    'Re-emit a SINGLE record_scope_verdict call with a fully schema-valid payload.',
  ].join('\n');
}
