/**
 * @file app/api/health/route.ts
 * @description Liveness + readiness probe.
 *                - GET /api/health        → liveness (always 200 with { ok: true }).
 *                - GET /api/health?deep=1 → readiness: checks DB + Redis + critical
 *                  env vars and returns the worst-case status.
 *
 *              Used by:
 *                - Vercel platform health checks (liveness only).
 *                - The post-deploy verify script (deep mode).
 *                - External uptime monitors (deep mode).
 *
 *              Deep mode runs in the Node runtime so it can talk to
 *              Postgres + Redis. Liveness mode stays on the edge runtime
 *              for lowest latency.
 */

import { NextResponse } from 'next/server';

import { logger } from '@/lib/utils/logger';

// Switch to nodejs runtime so deep mode can run Prisma + Upstash queries.
// Liveness mode would prefer edge but the dual-mode dispatch is simpler with
// a single runtime annotation.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const APP_VERSION = '0.1.0';

interface HealthResult {
  ok: boolean;
  version: string;
  /** When `?deep=1` is set, per-dependency results are included. */
  checks?: Record<string, { ok: boolean; latencyMs?: number; error?: string }>;
}

/** Required env vars whose absence makes the app non-functional in production. */
const REQUIRED_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'DATABASE_POOL_URL',
  'ENCRYPTION_KEY',
  'ANTHROPIC_API_KEY',
] as const;

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const value = await fn();
    return { value, latencyMs: Date.now() - start };
  } catch (e) {
    return {
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function checkDatabase(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const { prisma } = await import('@/lib/prisma');
  const result = await timed(() => prisma.$queryRaw`select 1 as ok`);
  if (result.error) return { ok: false, latencyMs: result.latencyMs, error: result.error };
  return { ok: true, latencyMs: result.latencyMs };
}

async function checkRedis(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  if (!process.env['UPSTASH_REDIS_REST_URL']) {
    return { ok: true, error: 'skipped (no Upstash configured)' };
  }
  const { Redis } = await import('@upstash/redis');
  const redis = new Redis({
    url: process.env['UPSTASH_REDIS_REST_URL']!,
    token: process.env['UPSTASH_REDIS_REST_TOKEN']!,
  });
  const result = await timed(() => redis.ping());
  if (result.error) return { ok: false, latencyMs: result.latencyMs, error: result.error };
  return { ok: true, latencyMs: result.latencyMs };
}

function checkRequiredEnv(): { ok: boolean; error?: string } {
  const missing = REQUIRED_ENV_VARS.filter((k) => !process.env[k]);
  if (missing.length === 0) return { ok: true };
  return { ok: false, error: `Missing: ${missing.join(', ')}` };
}

/**
 * GET /api/health[?deep=1]
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const deep = url.searchParams.get('deep') === '1';

  if (!deep) {
    const body: HealthResult = { ok: true, version: APP_VERSION };
    return NextResponse.json(body);
  }

  const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);
  const env = checkRequiredEnv();

  const overall = database.ok && redis.ok && env.ok;

  if (!overall) {
    logger.error('health.deep.failed', {
      database: database.ok,
      redis: redis.ok,
      env: env.ok,
      details: { database: database.error, redis: redis.error, env: env.error },
    });
  }

  const body: HealthResult = {
    ok: overall,
    version: APP_VERSION,
    checks: {
      database,
      redis,
      env,
    },
  };
  // Always 200 — health checks shouldn't trip pagers based on this status code;
  // monitoring systems read the body's `ok` field. We use 503 only for hard
  // unavailability that should pull the instance from rotation.
  return NextResponse.json(body, { status: overall ? 200 : 503 });
}
