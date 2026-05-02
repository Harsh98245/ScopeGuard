/**
 * @file lib/billing/limits.ts
 * @description Plan-limit accounting and enforcement helpers. Reads the
 *              user's planTier, resolves the {@link PlanLimits} via
 *              `getPlanLimits`, counts current usage, and returns either an
 *              "ok" verdict or a structured limit-exceeded reason.
 *
 *              Counters intentionally use Prisma instead of a cached counter
 *              column on the user row — the row is small, the queries are
 *              indexed, and the cache-invalidation cost of a counter column
 *              outweighs the read cost in v1. Promote to a counter column if
 *              this becomes a hot path.
 *
 *              Two enforcement points wired in session 8:
 *                - createProjectAction → `checkActiveProjectLimit`
 *                - POST /api/scope/check → `checkScopeCheckLimit`
 *
 *              The Postmark inbound pipeline does NOT enforce check limits.
 *              Inbound emails are billed-but-allowed so a paying customer
 *              never silently drops a real client message; we surface
 *              over-limit usage in the dashboard instead.
 */

import type { PlanTier } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { getPlanLimits, type PlanLimits } from '@/lib/stripe/plans';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result returned by every limit-check helper. */
export type LimitVerdict =
  | { allowed: true; usage: number; limit: number }
  | {
      allowed: false;
      usage: number;
      limit: number;
      /** Stable, machine-readable code for API error envelopes. */
      reason: 'PLAN_LIMIT_EXCEEDED';
      /** Lower-case capability name, used for the user-facing message. */
      capability: 'active-projects' | 'scope-checks-per-month';
      /** PlanTier the user would need to upgrade to in order to proceed. */
      suggestedTier: PlanTier;
    };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ISO timestamp for the start of the current calendar month, UTC. */
export function startOfCurrentMonthUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Pick the cheapest tier that satisfies the user's needs for the given
 * capability. Used to power "upgrade to X" CTAs in over-limit responses.
 */
function suggestTier(
  capability: 'active-projects' | 'scope-checks-per-month',
  currentTier: PlanTier,
): PlanTier {
  if (capability === 'active-projects' || capability === 'scope-checks-per-month') {
    if (currentTier === 'FREE') return 'STARTER';
    if (currentTier === 'STARTER') return 'PRO';
    return 'PRO';
  }
  return 'PRO';
}

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

/**
 * Count active projects owned by the user. ARCHIVED and COMPLETED projects
 * do not count against the limit so users can keep historical data without
 * being forced to upgrade.
 */
export async function countActiveProjects(userId: string): Promise<number> {
  return prisma.project.count({
    where: { userId, status: 'ACTIVE' },
  });
}

/**
 * Count scope checks created for the user this calendar month (UTC). Counts
 * across all of the user's projects, both inbound-email and manual checks.
 */
export async function countScopeChecksThisMonth(userId: string): Promise<number> {
  return prisma.scopeCheck.count({
    where: {
      project: { userId },
      createdAt: { gte: startOfCurrentMonthUtc() },
    },
  });
}

// ---------------------------------------------------------------------------
// Limit checks
// ---------------------------------------------------------------------------

/**
 * Verify the user has headroom under their plan's `activeProjects` limit.
 * Call this BEFORE the `prisma.project.create` so the new project counts
 * correctly against the cap.
 *
 * @param user - User context (id + tier).
 * @returns LimitVerdict.
 */
export async function checkActiveProjectLimit(user: {
  id: string;
  planTier: PlanTier;
}): Promise<LimitVerdict> {
  const limits: PlanLimits = getPlanLimits(user.planTier);
  const limit = limits.activeProjects;

  // Infinity is the explicit "no limit" sentinel for Pro and Business tiers.
  if (limit === Infinity) {
    return { allowed: true, usage: 0, limit: Number.POSITIVE_INFINITY };
  }

  const usage = await countActiveProjects(user.id);
  if (usage < limit) return { allowed: true, usage, limit };

  return {
    allowed: false,
    usage,
    limit,
    reason: 'PLAN_LIMIT_EXCEEDED',
    capability: 'active-projects',
    suggestedTier: suggestTier('active-projects', user.planTier),
  };
}

/**
 * Verify the user has headroom under their plan's monthly scope-check cap.
 * Call this BEFORE invoking `checkScope` so a denied check never burns AI
 * tokens.
 *
 * @param user - User context (id + tier).
 * @returns LimitVerdict.
 */
export async function checkScopeCheckLimit(user: {
  id: string;
  planTier: PlanTier;
}): Promise<LimitVerdict> {
  const limits: PlanLimits = getPlanLimits(user.planTier);
  const limit = limits.scopeChecksPerMonth;

  if (limit === Infinity) {
    return { allowed: true, usage: 0, limit: Number.POSITIVE_INFINITY };
  }

  const usage = await countScopeChecksThisMonth(user.id);
  if (usage < limit) return { allowed: true, usage, limit };

  return {
    allowed: false,
    usage,
    limit,
    reason: 'PLAN_LIMIT_EXCEEDED',
    capability: 'scope-checks-per-month',
    suggestedTier: suggestTier('scope-checks-per-month', user.planTier),
  };
}
