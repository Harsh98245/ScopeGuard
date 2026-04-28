/**
 * @file lib/ai/types.ts
 * @description Public TypeScript types produced by the AI layer. The runtime
 *              counterparts (Zod schemas + Anthropic tool input_schema) live
 *              alongside in `schemas.ts` so the type and the validator never
 *              drift apart — ParsedContract and ScopeCheckResult are inferred
 *              from those Zod schemas.
 *
 *              Consumers should import from `@/lib/ai` (the barrel) rather
 *              than this file directly.
 */

import type { z } from 'zod';

import type {
  ParsedContractSchema,
  ScopeCheckResultSchema,
} from '@/lib/ai/schemas';

/** Structured output of `parseContract`. Inferred from {@link ParsedContractSchema}. */
export type ParsedContract = z.infer<typeof ParsedContractSchema>;

/** Structured output of `checkScope`. Inferred from {@link ScopeCheckResultSchema}. */
export type ScopeCheckResult = z.infer<typeof ScopeCheckResultSchema>;

/** Lightweight project context the AI prompts can use to personalise drafts. */
export interface ProjectContext {
  /** Internal project name (rarely surfaced to the model — kept short). */
  name?: string;
  /** Client display name used in change-order drafts. */
  clientName?: string;
  /** Hourly rate used to monetise change orders. Optional. */
  hourlyRate?: number | string;
  /** ISO 4217 currency code, e.g. "USD". */
  currency?: string;
}
