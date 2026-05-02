/**
 * @file app/api/scope/check/route.ts
 * @description Manual scope-check endpoint. Accepts a JSON body with an email
 *              body + optional metadata, runs `checkScope` inline (synchronous
 *              AI call), persists the result, and returns the verdict.
 *
 *              This endpoint is for testing and UI-driven checks. Production
 *              inbound emails go through the Postmark webhook →
 *              processInboundEmail Inngest function instead.
 *
 *              Flow:
 *                1. Authenticate caller.
 *                2. Rate-limit by userId (scopeCheckLimiter: 50/h).
 *                3. Validate request body with Zod.
 *                4. Verify the project belongs to the caller.
 *                5. Load the latest parsed contract (if any).
 *                6. Call checkScope (AI, ~5-15s).
 *                7. Persist ScopeCheck row.
 *                8. Emit scope/check.completed to Inngest.
 *                9. Return 201 with the scope check.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { inngest } from '@/inngest/client';
import { checkScope } from '@/lib/ai';
import type { ParsedContract } from '@/lib/ai/types';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { checkScopeCheckLimit } from '@/lib/billing/limits';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/utils/logger';
import { scopeCheckLimiter, checkLimit } from '@/lib/utils/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const RequestSchema = z.object({
  /** UUID of the project to check against. */
  projectId: z.string().uuid(),
  /** Plain-text email body. Required; max 50k chars. */
  emailBody: z.string().min(1, 'Email body is required.').max(50_000),
  /** Optional subject line — improves verdict accuracy. */
  emailSubject: z.string().max(500).optional(),
  /** Optional sender address — used for project matching audit trail. */
  emailFromAddress: z.string().email().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ApiError {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
    upgradeTo?: string;
    usage?: number;
    limit?: number;
  };
}

function err(code: string, message: string, status: number) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

/**
 * Reconstruct a {@link ParsedContract} from a Contract Prisma row whose
 * `parsedAt` is not null. The column values are Prisma `Json` (unknown at
 * the type level), so we cast through as ParsedContract field types after
 * asserting non-null.
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

/** Empty contract used when no parsed contract exists. Claude will return AMBIGUOUS. */
function skeletonParsedContract(): ParsedContract {
  return {
    deliverables: [],
    exclusions: [],
    paymentTerms: {},
    overallRiskScore: 5,
    riskFlags: ['No parsed contract available — verdict will be AMBIGUOUS by default.'],
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * POST /api/scope/check
 *
 * @returns 201 with the created ScopeCheck row, or a structured error.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return err('UNAUTHENTICATED', 'Sign in required.', 401);

  const limited = await checkLimit(scopeCheckLimiter, user.id);
  if (limited) {
    return NextResponse.json<ApiError>(
      { error: { code: 'RATE_LIMITED', message: 'Too many scope checks — slow down.' } },
      { status: 429, headers: limited.headers },
    );
  }

  // Plan-limit gate: count this user's checks for the current calendar month
  // and reject if they've hit their tier's cap. The Postmark inbound pipeline
  // does NOT enforce this limit; only the API + manual UI path does.
  const planVerdict = await checkScopeCheckLimit(user);
  if (!planVerdict.allowed) {
    return NextResponse.json<ApiError>(
      {
        error: {
          code: 'PLAN_LIMIT_EXCEEDED',
          message: `You've used ${planVerdict.usage} of ${planVerdict.limit} scope checks this month on the ${user.planTier} plan. Upgrade to ${planVerdict.suggestedTier} for more.`,
          upgradeTo: planVerdict.suggestedTier,
          usage: planVerdict.usage,
          limit: planVerdict.limit,
        },
      },
      { status: 402 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err('INVALID_JSON', 'Request body must be valid JSON.', 400);
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json<ApiError>(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid request body.',
          fields: parsed.error.flatten().fieldErrors as Record<string, string[]>,
        },
      },
      { status: 400 },
    );
  }

  const { projectId, emailBody, emailSubject, emailFromAddress } = parsed.data;

  // Verify project ownership.
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: user.id },
  });
  if (!project) return err('NOT_FOUND', 'Project not found.', 404);

  // Load the latest parsed contract (null-safe — skeleton used if absent).
  const contract = await prisma.contract.findFirst({
    where: { projectId: project.id, parsedAt: { not: null } },
    orderBy: { createdAt: 'desc' },
  });

  const parsedContract: ParsedContract = contract
    ? rebuildParsedContract(contract)
    : skeletonParsedContract();

  // ---------- Run AI scope check -----------------------------------------
  let result;
  try {
    result = await checkScope({
      emailContent: emailBody,
      emailSubject,
      parsedContract,
      projectContext: {
        name: project.name,
        clientName: project.clientName,
        ...(project.hourlyRate ? { hourlyRate: project.hourlyRate.toString() } : {}),
        currency: project.currency,
      },
    });
  } catch (e) {
    logger.error('scope.check.manual.ai_failed', {
      userId: user.id,
      projectId: project.id,
      message: e instanceof Error ? e.message : String(e),
    });
    return err('INTERNAL', 'AI scope check failed. Please retry.', 500);
  }

  // ---------- Persist -------------------------------------------------------
  const scopeCheck = await prisma.scopeCheck.create({
    data: {
      projectId: project.id,
      contractId: contract?.id ?? null,
      rawEmailContent: emailBody,
      emailSubject: emailSubject ?? null,
      emailFromAddress: emailFromAddress ?? null,
      verdict: result.verdict,
      confidence: result.confidence,
      citedClause: result.citedClause,
      clauseReference: result.clauseReference,
      draftResponse: result.draftPoliteDecline,
      changeOrderText: result.draftChangeOrder,
      estimatedHours: result.estimatedAdditionalHours ?? null,
    },
  });

  // ---------- Notify --------------------------------------------------------
  await inngest.send({
    name: 'scope/check.completed',
    data: {
      userId: user.id,
      projectId: project.id,
      scopeCheckId: scopeCheck.id,
      verdict: scopeCheck.verdict,
      confidence: scopeCheck.confidence,
    },
  });

  logger.info('scope.check.manual.completed', {
    userId: user.id,
    projectId: project.id,
    scopeCheckId: scopeCheck.id,
    verdict: scopeCheck.verdict,
    confidence: scopeCheck.confidence,
    hasContract: contract !== null,
  });

  return NextResponse.json(
    {
      id: scopeCheck.id,
      verdict: scopeCheck.verdict,
      confidence: scopeCheck.confidence,
      citedClause: scopeCheck.citedClause,
      clauseReference: scopeCheck.clauseReference,
      draftResponse: scopeCheck.draftResponse,
      changeOrderText: scopeCheck.changeOrderText,
      estimatedHours: scopeCheck.estimatedHours,
      createdAt: scopeCheck.createdAt,
    },
    { status: 201 },
  );
}
