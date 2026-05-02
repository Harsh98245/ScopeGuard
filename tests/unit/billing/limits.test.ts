/**
 * @file tests/unit/billing/limits.test.ts
 * @description Unit tests for the plan-limit accounting helpers. Prisma is
 *              vi-mocked at the module level so the suite never touches a
 *              real database. Each test sets up the mock counts and asserts
 *              the LimitVerdict shape.
 *
 *              Critical properties under test:
 *                - PRO/BUSINESS users always get `allowed: true` regardless of usage.
 *                - FREE users hit the 1-project / 5-checks-per-month walls.
 *                - STARTER users hit 3-projects / 100-checks walls.
 *                - The suggestedTier is the cheapest tier that lifts the cap.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist the prisma mock so it's installed before the module-under-test imports it.
const projectCountMock = vi.fn();
const scopeCheckCountMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: { count: projectCountMock },
    scopeCheck: { count: scopeCheckCountMock },
  },
}));

import {
  checkActiveProjectLimit,
  checkScopeCheckLimit,
  startOfCurrentMonthUtc,
} from '@/lib/billing/limits';

beforeEach(() => {
  projectCountMock.mockReset();
  scopeCheckCountMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// startOfCurrentMonthUtc
// ---------------------------------------------------------------------------

describe('startOfCurrentMonthUtc', () => {
  it('snaps to the first of the month at 00:00 UTC', () => {
    const now = new Date('2026-04-29T15:34:11.123Z');
    const start = startOfCurrentMonthUtc(now);
    expect(start.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('handles January correctly (month=0)', () => {
    const now = new Date('2026-01-15T12:00:00Z');
    expect(startOfCurrentMonthUtc(now).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// checkActiveProjectLimit
// ---------------------------------------------------------------------------

describe('checkActiveProjectLimit', () => {
  it('FREE user under cap → allowed', async () => {
    projectCountMock.mockResolvedValueOnce(0);
    const v = await checkActiveProjectLimit({ id: 'u1', planTier: 'FREE' });
    expect(v).toEqual({ allowed: true, usage: 0, limit: 1 });
  });

  it('FREE user at cap → denied with STARTER suggestion', async () => {
    projectCountMock.mockResolvedValueOnce(1);
    const v = await checkActiveProjectLimit({ id: 'u1', planTier: 'FREE' });
    expect(v.allowed).toBe(false);
    if (v.allowed) return;
    expect(v.usage).toBe(1);
    expect(v.limit).toBe(1);
    expect(v.reason).toBe('PLAN_LIMIT_EXCEEDED');
    expect(v.capability).toBe('active-projects');
    expect(v.suggestedTier).toBe('STARTER');
  });

  it('STARTER user at cap → denied with PRO suggestion', async () => {
    projectCountMock.mockResolvedValueOnce(3);
    const v = await checkActiveProjectLimit({ id: 'u2', planTier: 'STARTER' });
    expect(v.allowed).toBe(false);
    if (v.allowed) return;
    expect(v.suggestedTier).toBe('PRO');
  });

  it('PRO user is unlimited (no DB call needed)', async () => {
    const v = await checkActiveProjectLimit({ id: 'u3', planTier: 'PRO' });
    expect(v.allowed).toBe(true);
    expect(projectCountMock).not.toHaveBeenCalled();
  });

  it('BUSINESS user is unlimited', async () => {
    const v = await checkActiveProjectLimit({ id: 'u4', planTier: 'BUSINESS' });
    expect(v.allowed).toBe(true);
    expect(projectCountMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// checkScopeCheckLimit
// ---------------------------------------------------------------------------

describe('checkScopeCheckLimit', () => {
  it('FREE user under monthly cap → allowed', async () => {
    scopeCheckCountMock.mockResolvedValueOnce(2);
    const v = await checkScopeCheckLimit({ id: 'u1', planTier: 'FREE' });
    expect(v).toEqual({ allowed: true, usage: 2, limit: 5 });
  });

  it('FREE user at cap → denied with STARTER suggestion', async () => {
    scopeCheckCountMock.mockResolvedValueOnce(5);
    const v = await checkScopeCheckLimit({ id: 'u1', planTier: 'FREE' });
    expect(v.allowed).toBe(false);
    if (v.allowed) return;
    expect(v.suggestedTier).toBe('STARTER');
  });

  it('STARTER user at cap → denied with PRO suggestion', async () => {
    scopeCheckCountMock.mockResolvedValueOnce(100);
    const v = await checkScopeCheckLimit({ id: 'u2', planTier: 'STARTER' });
    expect(v.allowed).toBe(false);
    if (v.allowed) return;
    expect(v.suggestedTier).toBe('PRO');
  });

  it('PRO user → no DB count, always allowed', async () => {
    const v = await checkScopeCheckLimit({ id: 'u3', planTier: 'PRO' });
    expect(v.allowed).toBe(true);
    expect(scopeCheckCountMock).not.toHaveBeenCalled();
  });

  it('passes a month-boundary `gte` filter to the count query', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-29T20:00:00Z'));
    scopeCheckCountMock.mockResolvedValueOnce(0);

    await checkScopeCheckLimit({ id: 'u1', planTier: 'FREE' });

    const args = scopeCheckCountMock.mock.calls[0]![0] as {
      where: { project: { userId: string }; createdAt: { gte: Date } };
    };
    expect(args.where.project.userId).toBe('u1');
    expect(args.where.createdAt.gte.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });
});
