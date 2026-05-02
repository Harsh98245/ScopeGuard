/**
 * @file app/api/webhooks/postmark/route.ts
 * @description Postmark inbound webhook receiver. The handler:
 *                1. Verifies the X-Postmark-Signature shared secret.
 *                2. Parses + validates the JSON body against
 *                   InboundPayloadSchema.
 *                3. Publishes a `scope/email.received` Inngest event whose
 *                   id is set to the Postmark MessageID for natural dedup.
 *                4. Returns 200 within 5 seconds.
 *
 *              All heavy work happens in the processInboundEmail Inngest
 *              function — never on this request path. The webhook MUST
 *              return 200 quickly so Postmark doesn't queue retries
 *              against an already-accepted message.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { inngest } from '@/inngest/client';
import {
  InboundPayloadSchema,
  toScopeEmailEvent,
  verifyPostmarkSignature,
} from '@/lib/email/inbound';
import { checkIpLimit, postmarkInboundLimiter } from '@/lib/utils/ipRateLimit';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ApiError {
  error: { code: string; message: string };
}
function err(code: string, message: string, status: number) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

/**
 * POST /api/webhooks/postmark
 *
 * @returns 200 with `{ accepted: true }` after enqueueing the Inngest event.
 */
export async function POST(request: NextRequest) {
  // IP-based rate limit BEFORE signature verification so we don't burn DB
  // round-trips on a flood of forged requests with bad signatures.
  const limited = await checkIpLimit(postmarkInboundLimiter, request);
  if (limited) {
    logger.warn('webhook.postmark.rate_limited', { ip: limited.ip });
    return NextResponse.json<ApiError>(
      { error: { code: 'RATE_LIMITED', message: 'Too many requests.' } },
      { status: 429, headers: limited.headers },
    );
  }

  if (!verifyPostmarkSignature(request.headers.get('x-postmark-signature'))) {
    logger.warn('webhook.postmark.unauthorized');
    return err('UNAUTHORIZED', 'Bad or missing X-Postmark-Signature.', 401);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return err('INVALID_JSON', 'Body must be valid JSON.', 400);
  }

  const parsed = InboundPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn('webhook.postmark.invalid_payload', {
      issues: parsed.error.issues.slice(0, 5).map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
    // Return 200 anyway — the message is malformed and retrying will not
    // help. This avoids Postmark hammering us forever.
    return NextResponse.json({ accepted: false, reason: 'invalid_payload' });
  }

  const eventData = toScopeEmailEvent(parsed.data);

  // Set the Inngest event id to the Postmark MessageID so any duplicate
  // webhook delivery from Postmark reuses the same id and Inngest's
  // built-in idempotency rejects the second copy.
  await inngest.send({
    id: eventData.postmarkMessageId,
    name: 'scope/email.received',
    data: eventData,
  });

  logger.info('webhook.postmark.accepted', {
    postmarkMessageId: eventData.postmarkMessageId,
    toAlias: eventData.toAlias,
    fromEmail: eventData.fromEmail,
  });

  return NextResponse.json({ accepted: true });
}
