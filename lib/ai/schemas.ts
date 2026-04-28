/**
 * @file lib/ai/schemas.ts
 * @description Single source of truth for the structured AI outputs. Each
 *              tool has TWO representations that must stay in lockstep:
 *
 *                1. A Zod schema, used for runtime validation of the
 *                   `tool_use` payload Claude returns.
 *                2. A JSON Schema (Anthropic's `input_schema`), sent to the
 *                   model so it knows the exact shape it must emit.
 *
 *              Hand-maintaining both in one file is preferable to a
 *              zod-to-json-schema dependency: the JSON we ship to Claude
 *              must include `description` fields the model uses heavily for
 *              quality, and those don't survive a generic conversion.
 */

import { z } from 'zod';

// =============================================================================
// parseContract — record_parsed_contract tool
// =============================================================================

const DeliverableSchema = z.object({
  id: z.string().min(1).max(64),
  clauseReference: z
    .string()
    .min(1)
    .max(120)
    .describe('Section/clause label as it appears in the contract, e.g. "Section 2.1".'),
  text: z.string().min(1).max(4000).describe('Verbatim or near-verbatim clause text.'),
  isAmbiguous: z.boolean(),
  ambiguityReason: z.string().max(2000).optional(),
});

const ExclusionSchema = z.object({
  clauseReference: z.string().min(1).max(120),
  text: z.string().min(1).max(4000),
});

const PaymentTermsSchema = z.object({
  amount: z.number().nonnegative().optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, '3-letter ISO 4217 currency code.')
    .optional(),
  schedule: z.string().max(500).optional(),
  lateFeeClause: z.string().max(1000).optional(),
});

/** Runtime-validated shape of `parseContract` output. */
export const ParsedContractSchema = z.object({
  deliverables: z.array(DeliverableSchema).max(50),
  exclusions: z.array(ExclusionSchema).max(50),
  paymentTerms: PaymentTermsSchema,
  revisionPolicy: z.string().max(2000).optional(),
  overallRiskScore: z.number().int().min(1).max(10),
  riskFlags: z.array(z.string().max(500)).max(20),
});

/** Anthropic-facing JSON Schema for the `record_parsed_contract` tool. */
export const ParsedContractJsonSchema = {
  type: 'object',
  required: ['deliverables', 'exclusions', 'paymentTerms', 'overallRiskScore', 'riskFlags'],
  properties: {
    deliverables: {
      type: 'array',
      maxItems: 50,
      description:
        'The explicit work products the freelancer is contracted to deliver. Mark isAmbiguous=true when the clause uses vague language ("reasonable revisions", "as needed", "industry standard") that could fuel a future scope dispute.',
      items: {
        type: 'object',
        required: ['id', 'clauseReference', 'text', 'isAmbiguous'],
        properties: {
          id: {
            type: 'string',
            description: 'Stable identifier you assign, e.g. "d1", "d2". Used for cross-reference.',
          },
          clauseReference: {
            type: 'string',
            description:
              'Where the clause appears in the contract. Use the contract\'s own labelling ("Section 2.1", "Appendix A item 3", etc.).',
          },
          text: {
            type: 'string',
            description: 'Verbatim or near-verbatim clause text describing the deliverable.',
          },
          isAmbiguous: {
            type: 'boolean',
            description: 'True iff the clause uses vague or open-ended language.',
          },
          ambiguityReason: {
            type: 'string',
            description:
              'When isAmbiguous=true, a short plain-English explanation of WHY it is ambiguous. Omit when isAmbiguous=false.',
          },
        },
      },
    },
    exclusions: {
      type: 'array',
      maxItems: 50,
      description:
        'Items the contract EXPLICITLY puts out of scope. Only include genuine exclusions — do not infer from absence.',
      items: {
        type: 'object',
        required: ['clauseReference', 'text'],
        properties: {
          clauseReference: { type: 'string' },
          text: { type: 'string' },
        },
      },
    },
    paymentTerms: {
      type: 'object',
      description: 'Structured payment information when the contract specifies any.',
      properties: {
        amount: { type: 'number', description: 'Total contract amount in major units.' },
        currency: { type: 'string', description: '3-letter ISO 4217 code, e.g. "USD".' },
        schedule: {
          type: 'string',
          description: 'Plain-text payment schedule, e.g. "50% on signing, 50% on delivery".',
        },
        lateFeeClause: {
          type: 'string',
          description: 'Late-fee or interest clause text when present.',
        },
      },
    },
    revisionPolicy: {
      type: 'string',
      description:
        'Revision-rounds policy text, e.g. "Up to two rounds of revisions per page". Omit when absent.',
    },
    overallRiskScore: {
      type: 'integer',
      minimum: 1,
      maximum: 10,
      description:
        'Holistic 1-10 risk score for scope disputes. 1 = airtight, 10 = riddled with vague language and missing exclusions.',
    },
    riskFlags: {
      type: 'array',
      maxItems: 20,
      items: { type: 'string' },
      description:
        'Short human-readable warnings the user should see, e.g. "No revision limit specified", "Payment schedule undefined".',
    },
  },
  additionalProperties: false,
} as const;

// =============================================================================
// checkScope — record_scope_verdict tool
// =============================================================================

const VerdictEnum = z.enum(['IN_SCOPE', 'OUT_OF_SCOPE', 'AMBIGUOUS']);

/** Runtime-validated shape of `checkScope` output. */
export const ScopeCheckResultSchema = z.object({
  verdict: VerdictEnum,
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1).max(2000),
  citedClause: z.string().max(4000).nullable(),
  clauseReference: z.string().max(120).nullable(),
  draftPoliteDecline: z.string().min(1).max(4000),
  draftChangeOrder: z.string().min(1).max(4000),
  estimatedAdditionalHours: z.number().nonnegative().max(10000).nullable().optional(),
});

/** Anthropic-facing JSON Schema for the `record_scope_verdict` tool. */
export const ScopeCheckResultJsonSchema = {
  type: 'object',
  required: [
    'verdict',
    'confidence',
    'reasoning',
    'citedClause',
    'clauseReference',
    'draftPoliteDecline',
    'draftChangeOrder',
  ],
  properties: {
    verdict: {
      type: 'string',
      enum: ['IN_SCOPE', 'OUT_OF_SCOPE', 'AMBIGUOUS'],
      description:
        'IN_SCOPE: covered by an existing deliverable. OUT_OF_SCOPE: matches an explicit exclusion or clearly outside any deliverable. AMBIGUOUS: contract does not clearly resolve.',
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description:
        'Your confidence in the verdict. Use 0.85+ only when you can cite a specific clause. Use <0.6 to signal genuine uncertainty.',
    },
    reasoning: {
      type: 'string',
      description: '1-3 sentences explaining the verdict in plain English.',
    },
    citedClause: {
      type: ['string', 'null'],
      description:
        'Verbatim contract text supporting your verdict. Null only when no clause is on point (typically AMBIGUOUS verdicts).',
    },
    clauseReference: {
      type: ['string', 'null'],
      description: 'Section/clause label matching `citedClause`, e.g. "§2.2".',
    },
    draftPoliteDecline: {
      type: 'string',
      description:
        'A complete, ready-to-paste email replying to the client. Professional tone, references the cited clause when applicable, and offers a path forward (e.g. change order). Sign off with a placeholder name.',
    },
    draftChangeOrder: {
      type: 'string',
      description:
        'A complete change-order draft with line items, hours estimate, and a price placeholder using the project hourly rate.',
    },
    estimatedAdditionalHours: {
      type: ['number', 'null'],
      description:
        'Additional hours required to deliver the requested out-of-scope work. Null when in-scope or unestimatable.',
    },
  },
  additionalProperties: false,
} as const;
