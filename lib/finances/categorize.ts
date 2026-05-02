/**
 * @file lib/finances/categorize.ts
 * @description AI categoriser for expense transactions. Given a free-form
 *              description (e.g. "GITHUB.COM 4-MONTH-CHARGE 17.00") it
 *              returns one of the fixed categories from
 *              `lib/finances/categories.ts` plus a tax-deductibility
 *              recommendation.
 *
 *              Uses Claude tool_use with a forced single-tool call and a
 *              z.enum-validated input schema, so the model can never invent
 *              new category slugs.
 *
 *              Retries up to {@link MAX_ATTEMPTS} times on a Zod validation
 *              failure; passes the validation issues back to the model on
 *              the retry so it can self-correct. Logs token usage so the
 *              billing dashboard can attribute AI cost per user.
 */

import 'server-only';

import { z } from 'zod';

import { callTool } from '@/lib/ai/client';
import { logger } from '@/lib/utils/logger';
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
  defaultDeductible,
} from '@/lib/finances/categories';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How many round-trips we'll burn trying to coax a valid response out of Claude. */
const MAX_ATTEMPTS = 3;
const TOOL_NAME = 'record_expense_category';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const ExpenseCategorySchema = z.enum(
  // The Zod helper requires a non-empty tuple — reflect EXPENSE_CATEGORIES
  // through `as` to satisfy the type while keeping the source of truth in one place.
  EXPENSE_CATEGORIES as readonly string[] as readonly [ExpenseCategory, ...ExpenseCategory[]],
);

const CategorizeResultSchema = z.object({
  category: ExpenseCategorySchema,
  taxDeductible: z
    .boolean()
    .describe('Best-guess on whether this expense is deductible. User can override.'),
  confidence: z.number().min(0).max(1),
  reasoning: z
    .string()
    .min(1)
    .max(500)
    .describe('One short sentence justifying the category choice.'),
});

export type CategorizeResult = z.infer<typeof CategorizeResultSchema>;

// JSON Schema for Anthropic — keep field descriptions rich; Claude leans on them.
const CategorizeJsonSchema = {
  type: 'object',
  required: ['category', 'taxDeductible', 'confidence', 'reasoning'],
  properties: {
    category: {
      type: 'string',
      enum: EXPENSE_CATEGORIES,
      description:
        'The single best-fitting expense category. Must be one of the listed values exactly. ' +
        'Pick "other" only when no other category is even slightly plausible.',
    },
    taxDeductible: {
      type: 'boolean',
      description:
        'true if a typical solo freelancer/sole-proprietor could deduct this expense ' +
        'against business income (US/CA/UK common defaults). When uncertain, default to true ' +
        'for software/hardware/office/professional-services and false for taxes/personal items.',
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description:
        'Calibrated confidence in the category choice. Use 0.9+ only when the description ' +
        'unambiguously identifies a vendor (e.g. "GITHUB.COM" → software at 0.95+).',
    },
    reasoning: {
      type: 'string',
      minLength: 1,
      maxLength: 500,
      description:
        'One short sentence justifying the category. Mention the vendor or keyword that drove the decision.',
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class CategorizeError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CategorizeError';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CategorizeInput {
  /** Free-text description from the source (Stripe, PayPal, manual entry). */
  description: string;
  /** Optional amount + currency; helps the model distinguish scale. */
  amount?: string;
  currency?: string;
}

/**
 * Categorise a single expense via Claude tool_use. The output is validated
 * against {@link CategorizeResultSchema}; on validation failure, retries
 * with a re-prompt that includes the validation issues so the model can
 * self-correct. Throws {@link CategorizeError} after MAX_ATTEMPTS retries.
 *
 * @param input - Description plus optional amount/currency context.
 * @returns Validated CategorizeResult.
 *
 * @example
 *   const result = await categorizeExpense({
 *     description: 'GITHUB.COM 4-MONTH-CHARGE',
 *     amount: '17.00',
 *     currency: 'USD',
 *   });
 *   // → { category: 'software', taxDeductible: true, confidence: 0.96, reasoning: '...' }
 */
export async function categorizeExpense(
  input: CategorizeInput,
): Promise<CategorizeResult> {
  const description = input.description.trim();
  if (description.length === 0) {
    throw new CategorizeError('Description is empty.', 0);
  }

  const system =
    `You are a small-business accountant categorising a single expense. ` +
    `You will be given a transaction description (and optionally amount + currency). ` +
    `Pick the single best category from the enumerated list and call the ` +
    `${TOOL_NAME} tool with your verdict. ` +
    `Never invent a category. If multiple categories fit, pick the more specific one.`;

  let userText = `Description: ${description}`;
  if (input.amount) userText += `\nAmount: ${input.amount} ${input.currency ?? ''}`.trim();

  let lastIssues: string | null = null;
  let lastUsage: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const promptText = lastIssues
      ? `${userText}\n\nYour previous answer failed validation:\n${lastIssues}\n\nReturn a corrected ${TOOL_NAME} call.`
      : userText;

    const result = await callTool({
      system,
      messages: [{ role: 'user', content: promptText }],
      tools: [
        {
          name: TOOL_NAME,
          description: 'Record the expense category, tax-deductibility, and confidence.',
          input_schema: CategorizeJsonSchema,
        },
      ],
      toolName: TOOL_NAME,
      maxTokens: 512,
    });
    lastUsage = result.usage;

    const parsed = CategorizeResultSchema.safeParse(result.input);
    if (parsed.success) {
      logger.info('ai.categorize.completed', {
        attempts: attempt,
        category: parsed.data.category,
        confidence: parsed.data.confidence,
        usage: result.usage,
      });
      return parsed.data;
    }

    lastIssues = parsed.error.issues
      .map((i) => `- ${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('\n');

    logger.warn('ai.categorize.invalid_payload', {
      attempt,
      issues: lastIssues,
    });
  }

  throw new CategorizeError(
    `Claude returned an invalid categoriser payload after ${MAX_ATTEMPTS} attempts.`,
    MAX_ATTEMPTS,
    { lastIssues, lastUsage },
  );
}

/**
 * Convenience helper used by the manual-transaction form when the user did
 * not supply a category — runs `categorizeExpense` and aligns
 * `taxDeductible` with our category default when the model isn't confident.
 *
 * @param input - Same as `categorizeExpense`.
 * @returns Category, deductibility, plus confidence + reasoning.
 */
export async function categorizeWithDefaults(
  input: CategorizeInput,
): Promise<CategorizeResult> {
  const result = await categorizeExpense(input);
  if (result.confidence < 0.5) {
    return { ...result, taxDeductible: defaultDeductible(result.category) };
  }
  return result;
}
