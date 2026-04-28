/**
 * @file lib/ai/parseContract.ts
 * @description Parses a freelance contract document and extracts structured
 *              scope data: deliverables, exclusions, payment terms, ambiguous
 *              language, and a 1-10 risk score.
 *
 *              Implementation invariants (see ADR-003):
 *                - Always uses Claude tool_use with a strict input_schema.
 *                  We never parse free-form text.
 *                - On schema validation failure (Zod), retries up to
 *                  MAX_ATTEMPTS times with a re-prompt that includes the
 *                  validation errors so the model can correct itself.
 *                - On all retries exhausted, throws ContractParseError
 *                  with `attempts` set so callers can decide what to do.
 *                - Logs `ai.parseContract.completed` on success with token
 *                  usage so cost regressions are visible in production.
 */

import 'server-only';

import { z } from 'zod';

import { callTool } from '@/lib/ai/client';
import { ContractParseError } from '@/lib/ai/errors';
import { ParsedContractJsonSchema, ParsedContractSchema } from '@/lib/ai/schemas';
import type { ParsedContract, ProjectContext } from '@/lib/ai/types';
import { logger } from '@/lib/utils/logger';

/**
 * Maximum number of times we'll re-prompt the model when its tool_use payload
 * fails Zod validation. The first call counts as attempt 1, so MAX_ATTEMPTS=3
 * means up to two re-prompts.
 */
const MAX_ATTEMPTS = 3;

/** Hard cap on contract text we forward to the model. ~30 pages of typical
 *  legal text. Longer contracts must be summarised by the caller first. */
const CONTRACT_TEXT_HARD_LIMIT = 120_000;

const TOOL_NAME = 'record_parsed_contract';

const SYSTEM_PROMPT = `You are an expert at extracting structured scope data from freelance and consulting contracts.

You will be given the full text of a single contract. Your job:

1. Identify every clause that describes a deliverable. Mark a deliverable as ambiguous when it uses vague language ("reasonable", "as needed", "industry standard", "minor revisions", "etc.") that could fuel a future scope dispute.
2. Identify clauses that EXPLICITLY put work out of scope. Do not infer exclusions from absence — only record genuine exclusions.
3. Capture payment terms when stated (amount, currency, schedule, late-fee clause).
4. Capture revision-rounds policy when stated.
5. Score overall scope-dispute risk on a 1-10 scale based on how much vague language and how many missing safeguards you see.
6. Surface short, human-readable risk warnings in riskFlags.

You MUST emit your answer by calling the record_parsed_contract tool exactly once. Do not add any conversational text.`;

export interface ParseContractInput {
  /** Full plain text of the contract. */
  contractText: string;
  /** Optional project context to help the model resolve client/project names. */
  projectContext?: ProjectContext;
}

/**
 * Parse a freelance contract and return its structured scope data.
 *
 * @param input - Contract text plus optional project context.
 * @returns A {@link ParsedContract} validated against {@link ParsedContractSchema}.
 * @throws {@link ContractParseError} when the model fails to return a valid
 *         structured payload after {@link MAX_ATTEMPTS} attempts.
 *
 * @example
 *   const parsed = await parseContract({
 *     contractText: rawText,
 *     projectContext: { name: 'Acme Marketing Site', clientName: 'Acme Corp' },
 *   });
 *   await prisma.contract.update({
 *     where: { id: contract.id },
 *     data: {
 *       deliverables: parsed.deliverables,
 *       exclusions: parsed.exclusions,
 *       paymentTerms: parsed.paymentTerms,
 *       overallRiskScore: parsed.overallRiskScore,
 *       parsedAt: new Date(),
 *     },
 *   });
 */
export async function parseContract(input: ParseContractInput): Promise<ParsedContract> {
  const text = input.contractText.trim();
  if (text.length === 0) {
    throw new ContractParseError('Contract text is empty.', 0);
  }
  if (text.length > CONTRACT_TEXT_HARD_LIMIT) {
    throw new ContractParseError(
      `Contract text exceeds ${CONTRACT_TEXT_HARD_LIMIT} chars; pre-summarise before calling parseContract.`,
      0,
    );
  }

  const projectPrefix = input.projectContext
    ? formatProjectContext(input.projectContext) + '\n\n'
    : '';

  const tool = {
    name: TOOL_NAME,
    description:
      'Record the structured scope data extracted from the contract. Must be called exactly once.',
    input_schema: ParsedContractJsonSchema,
  } as const;

  let lastValidationError: z.ZodError | null = null;
  let lastRawInput: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const userText =
      attempt === 1
        ? `${projectPrefix}Contract text follows. Extract scope data and call record_parsed_contract.\n\n---\n${text}\n---`
        : retryUserText(text, projectPrefix, lastValidationError, lastRawInput);

    const startedAt = Date.now();
    let raw: unknown;
    try {
      const result = await callTool({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userText }],
        // The SDK accepts our `as const` JSON schema as Tool['input_schema'].
        tools: [tool as unknown as Parameters<typeof callTool>[0]['tools'][number]],
        toolName: TOOL_NAME,
        maxTokens: 4096,
      });
      raw = result.input;

      const parsed = ParsedContractSchema.safeParse(raw);
      if (parsed.success) {
        logger.info('ai.parseContract.completed', {
          attempt,
          latencyMs: Date.now() - startedAt,
          inputTokens: result.usage.input_tokens,
          outputTokens: result.usage.output_tokens,
          deliverableCount: parsed.data.deliverables.length,
          exclusionCount: parsed.data.exclusions.length,
          riskScore: parsed.data.overallRiskScore,
        });
        return parsed.data;
      }

      lastValidationError = parsed.error;
      lastRawInput = raw;
      logger.warn('ai.parseContract.invalid_payload', {
        attempt,
        issues: parsed.error.issues.slice(0, 5).map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    } catch (err) {
      // Network / SDK / no-tool-block errors. The SDK already retries network
      // failures; if we get here, it's worth surfacing as a parse error so
      // callers don't loop forever.
      throw new ContractParseError(
        `parseContract failed on attempt ${attempt}: ${err instanceof Error ? err.message : String(err)}`,
        attempt,
        err,
      );
    }
  }

  throw new ContractParseError(
    `parseContract exhausted ${MAX_ATTEMPTS} attempts without a schema-valid payload.`,
    MAX_ATTEMPTS,
    lastValidationError ?? undefined,
  );
}

function formatProjectContext(ctx: ProjectContext): string {
  const lines: string[] = ['Project context (for clause references — do not invent facts):'];
  if (ctx.name) lines.push(`- Project name: ${ctx.name}`);
  if (ctx.clientName) lines.push(`- Client: ${ctx.clientName}`);
  if (ctx.hourlyRate !== undefined) lines.push(`- Hourly rate: ${ctx.hourlyRate} ${ctx.currency ?? ''}`);
  return lines.join('\n');
}

/**
 * Build the user message for a retry attempt. Includes the prior validation
 * errors so the model can self-correct rather than emitting the same shape
 * again. Bounded to keep retry tokens predictable.
 */
function retryUserText(
  contractText: string,
  projectPrefix: string,
  zodErr: z.ZodError | null,
  prior: unknown,
): string {
  const issuesSummary = zodErr
    ? zodErr.issues
        .slice(0, 8)
        .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n')
    : '- (no validation issues captured)';

  const priorJson = (() => {
    try {
      return JSON.stringify(prior).slice(0, 2000);
    } catch {
      return '(prior payload not serialisable)';
    }
  })();

  return [
    `${projectPrefix}Your previous record_parsed_contract call did not match the required schema.`,
    '',
    'Validation issues:',
    issuesSummary,
    '',
    `Your previous payload (truncated): ${priorJson}`,
    '',
    'Re-emit a SINGLE record_parsed_contract call with a fully schema-valid payload. Do not include any conversational text. The contract text follows.',
    '',
    '---',
    contractText,
    '---',
  ].join('\n');
}
