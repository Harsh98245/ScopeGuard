/**
 * @file lib/email/inbound.ts
 * @description Postmark inbound webhook helpers — payload schema and shared-
 *              secret authentication. Postmark inbound webhooks are NOT
 *              cryptographically signed by default, so we authenticate via
 *              a custom header `X-Postmark-Signature` whose value is set
 *              when configuring the Postmark Server's inbound webhook URL
 *              (Postmark sends an exact echo of the configured value).
 *              See ADR-002 and docs/RUNBOOK.md for setup.
 *
 *              The webhook handler MUST:
 *                1. Verify the header with constant-time comparison.
 *                2. Validate the JSON body against InboundPayloadSchema.
 *                3. Return 200 within 5 seconds — heavy work is async.
 */

import { z } from 'zod';

import { safeEqual } from '@/lib/utils/encryption';

/**
 * Verify a Postmark inbound webhook by comparing the X-Postmark-Signature
 * header against the shared secret (env: POSTMARK_WEBHOOK_SECRET).
 *
 * @param headerValue - Value of `X-Postmark-Signature` (or null when absent).
 * @returns true when the secret matches; false otherwise.
 *
 * @example
 *   if (!verifyPostmarkSignature(req.headers.get('x-postmark-signature'))) {
 *     return new Response('unauthorized', { status: 401 });
 *   }
 */
export function verifyPostmarkSignature(headerValue: string | null): boolean {
  const secret = process.env['POSTMARK_WEBHOOK_SECRET'];
  if (!secret) return false;
  if (!headerValue) return false;
  return safeEqual(headerValue, secret);
}

/**
 * Subset of the Postmark inbound payload we actually use. Postmark's full
 * payload is much larger; we deliberately pluck only the fields we trust.
 *
 * `StrippedTextReply` is the reply-only body with quoted history stripped —
 * exactly what we want to feed Claude. Fall back to `TextBody` when absent.
 */
export const InboundPayloadSchema = z
  .object({
    MessageID: z.string().min(1).max(120),
    From: z.string().min(1).max(320),
    FromFull: z
      .object({ Email: z.string().email(), Name: z.string().optional() })
      .optional(),
    To: z.string().min(1).max(320),
    ToFull: z
      .array(z.object({ Email: z.string().email() }))
      .min(1)
      .optional(),
    Subject: z.string().max(998).optional().default(''),
    TextBody: z.string().max(200_000).optional().default(''),
    StrippedTextReply: z.string().max(200_000).optional().default(''),
    HtmlBody: z.string().max(400_000).optional().default(''),
  })
  .strip(); // ignore extra fields rather than fail on schema drift

export type InboundPayload = z.infer<typeof InboundPayloadSchema>;

/**
 * Lift the canonical fields out of a parsed Postmark payload into the
 * Inngest event shape declared in inngest/client.ts.
 *
 * Picks the most useful body — StrippedTextReply when available (no
 * quoted history), otherwise TextBody.
 *
 * @param payload - A previously schema-validated InboundPayload.
 * @returns The fields needed to publish `scope/email.received`.
 */
export function toScopeEmailEvent(payload: InboundPayload): {
  postmarkMessageId: string;
  toAlias: string;
  fromEmail: string;
  subject: string;
  bodyText: string;
} {
  const fromEmail = payload.FromFull?.Email ?? extractEmailAddress(payload.From);
  const toAlias = payload.ToFull?.[0]?.Email ?? extractEmailAddress(payload.To);
  const bodyText = (payload.StrippedTextReply || payload.TextBody || '').trim();

  return {
    postmarkMessageId: payload.MessageID,
    toAlias: toAlias.toLowerCase(),
    fromEmail: fromEmail.toLowerCase(),
    subject: payload.Subject ?? '',
    bodyText,
  };
}

/**
 * Extract just the email address from a header value that might be:
 *   - "Jane Doe <jane@example.com>"
 *   - "jane@example.com"
 *   - "<jane@example.com>"
 *
 * Falls back to the raw value if no `<…>` pair is found.
 */
function extractEmailAddress(headerValue: string): string {
  const match = headerValue.match(/<([^>]+)>/);
  if (match?.[1]) return match[1].trim();
  return headerValue.trim();
}
