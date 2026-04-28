/**
 * @file lib/ai/index.ts
 * @description Barrel export for the AI layer. Consumers should import from
 *              here rather than reaching into individual files.
 */

export { parseContract } from '@/lib/ai/parseContract';
export { checkScope } from '@/lib/ai/checkScope';
export { AIError, ContractParseError, ScopeCheckError } from '@/lib/ai/errors';
export {
  ParsedContractSchema,
  ParsedContractJsonSchema,
  ScopeCheckResultSchema,
  ScopeCheckResultJsonSchema,
} from '@/lib/ai/schemas';
export type { ParsedContract, ProjectContext, ScopeCheckResult } from '@/lib/ai/types';
