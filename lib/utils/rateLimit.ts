/**
 * @file lib/utils/rateLimit.ts
 * @description Per-user / per-IP rate limiters backed by Upstash Redis. Each
 *              limiter is a sliding window. Caller supplies a stable
 *              identifier (userId for authed routes, IP for public routes).
 *
 *              Limits are enforced at the API route boundary; do not call
 *              from background jobs.
 *
 * @author ScopeGuard
 * @lastModified 2026-04-27
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (_redis) return _redis;
  _redis = new Redis({
    url: process.env['UPSTASH_REDIS_REST_URL']!,
    token: process.env['UPSTASH_REDIS_REST_TOKEN']!,
  });
  return _redis;
}

/**
 * /api/scope/check — 50 requests/hour per user.
 * Heavy because each request hits Claude.
 */
export const scopeCheckLimiter = new Ratelimit({
  redis: getRedis(),
  limiter: Ratelimit.slidingWindow(50, '1 h'),
  prefix: 'rl:scope-check',
  analytics: true,
});

/**
 * /api/contracts/[id]/parse — 10 requests/hour per user.
 * Long-running; rare to hit legitimately.
 */
export const contractParseLimiter = new Ratelimit({
  redis: getRedis(),
  limiter: Ratelimit.slidingWindow(10, '1 h'),
  prefix: 'rl:contract-parse',
  analytics: true,
});

/**
 * Auth endpoints — 10 requests/minute per IP.
 * Mitigates credential stuffing.
 */
export const authLimiter = new Ratelimit({
  redis: getRedis(),
  limiter: Ratelimit.slidingWindow(10, '1 m'),
  prefix: 'rl:auth',
  analytics: true,
});

/**
 * Convenience helper — apply a limiter and return a 429 NextResponse if
 * exhausted.
 *
 * @param limiter - One of the exported Ratelimit instances.
 * @param identifier - Stable string (userId or IP).
 * @returns null if under the limit, otherwise an object with `retryAfter`
 *          seconds and standard rate-limit headers.
 */
export async function checkLimit(
  limiter: Ratelimit,
  identifier: string,
): Promise<
  | null
  | {
      retryAfter: number;
      headers: Record<string, string>;
    }
> {
  const { success, reset, limit, remaining } = await limiter.limit(identifier);
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': String(reset),
  };
  if (success) return null;
  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return { retryAfter, headers: { ...headers, 'Retry-After': String(retryAfter) } };
}
