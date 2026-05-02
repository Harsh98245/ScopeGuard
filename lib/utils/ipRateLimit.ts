/**
 * @file lib/utils/ipRateLimit.ts
 * @description IP-based rate limiters for unauthenticated public endpoints
 *              (webhooks, OAuth callbacks). Distinct from
 *              `lib/utils/rateLimit.ts` so the per-user and per-IP windows
 *              don't share a Redis key prefix.
 *
 *              Resolves the caller's IP from Vercel's `x-forwarded-for`
 *              header (the convention on every modern reverse-proxy hosting
 *              platform). Falls back to `x-real-ip` and finally a literal
 *              `unknown` so a missing header never crashes the route — the
 *              limiter still applies, just bucketed under one key.
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

// ---------------------------------------------------------------------------
// Limiters
// ---------------------------------------------------------------------------

/**
 * Inbound Postmark webhook — 600 requests/hour per source IP.
 * Postmark legitimately bursts during high-volume periods; the cap is meant
 * to absorb that while bouncing forged requests from random origins.
 */
export const postmarkInboundLimiter = new Ratelimit({
  redis: getRedis(),
  limiter: Ratelimit.slidingWindow(600, '1 h'),
  prefix: 'rl:ip:postmark-inbound',
  analytics: true,
});

/**
 * Stripe webhook — 1000 requests/hour per source IP. Stripe replays plus
 * signed-batch dispatch can spike; the cap is generous so a legitimate
 * cluster never gets throttled.
 */
export const stripeWebhookLimiter = new Ratelimit({
  redis: getRedis(),
  limiter: Ratelimit.slidingWindow(1000, '1 h'),
  prefix: 'rl:ip:stripe-webhook',
  analytics: true,
});

/**
 * OAuth callback (Stripe Connect / PayPal) — 30 requests/hour per IP.
 * Legitimate users hit this once per connect; the cap protects against
 * code-replay or scanner traffic.
 */
export const oauthCallbackLimiter = new Ratelimit({
  redis: getRedis(),
  limiter: Ratelimit.slidingWindow(30, '1 h'),
  prefix: 'rl:ip:oauth-callback',
  analytics: true,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the caller IP from a Web Request's headers. Honours the standard
 * forwarded-for chain that Vercel (+ most proxies) populate.
 *
 * @param request - The Web Request.
 * @returns The caller's IP, or `'unknown'` when no forwarded header is set.
 */
export function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    // The first entry is the original client; subsequent entries are the
    // proxy chain. Trim whitespace defensively.
    const first = xff.split(',')[0]?.trim();
    if (first && first.length > 0) return first;
  }
  const xri = request.headers.get('x-real-ip');
  if (xri) return xri.trim();
  return 'unknown';
}

/**
 * Apply an IP-based limiter and return a 429-ready descriptor if exhausted.
 *
 * @param limiter - One of the exported per-IP Ratelimit instances.
 * @param request - The incoming Web Request.
 * @returns null when the request is allowed, otherwise headers + retry-after seconds.
 */
export async function checkIpLimit(
  limiter: Ratelimit,
  request: Request,
): Promise<
  | null
  | {
      retryAfter: number;
      headers: Record<string, string>;
      ip: string;
    }
> {
  const ip = getClientIp(request);
  const { success, reset, limit, remaining } = await limiter.limit(ip);
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': String(reset),
  };
  if (success) return null;
  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return {
    retryAfter,
    headers: { ...headers, 'Retry-After': String(retryAfter) },
    ip,
  };
}
