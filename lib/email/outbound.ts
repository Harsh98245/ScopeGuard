/**
 * @file lib/email/outbound.ts
 * @description Outbound transactional email via Postmark. Used by the
 *              Inngest `notifyUserOfVerdict` function and (later) by Stripe
 *              dunning and weekly digest jobs.
 *
 *              All outbound goes from `OUTBOUND_FROM_EMAIL` and respects a
 *              per-call `MessageStream` so production / sandbox isolation is
 *              easy. Errors are surfaced to the caller — the Inngest
 *              function decides whether to retry.
 */

import 'server-only';

import { ServerClient } from 'postmark';

let _client: ServerClient | null = null;

/** Lazy Postmark client. Reads `POSTMARK_SERVER_TOKEN` on first call. */
export function getPostmarkClient(): ServerClient {
  if (_client) return _client;
  const token = process.env['POSTMARK_SERVER_TOKEN'];
  if (!token) throw new Error('POSTMARK_SERVER_TOKEN env var is required.');
  _client = new ServerClient(token);
  return _client;
}

/** Reset the cached client. Test-only helper. */
export function resetPostmarkClient(): void {
  _client = null;
}

export interface SendEmailParams {
  /** Recipient address. */
  to: string;
  /** Subject line. */
  subject: string;
  /** Plain-text body. */
  textBody: string;
  /** Optional HTML body. When omitted, Postmark renders text-only. */
  htmlBody?: string;
  /** Optional Postmark MessageStream override. Defaults to "outbound". */
  messageStream?: string;
}

/**
 * Send a transactional email.
 *
 * @param params - Recipient, subject, body.
 * @returns The MessageID Postmark assigned, or null on dry-run when
 *          `POSTMARK_SERVER_TOKEN` is unset and we're outside production
 *          (handy for local development without a Postmark account).
 *
 * @example
 *   await sendEmail({ to: user.email, subject: 'Verdict ready', textBody: '...' });
 */
export async function sendEmail(params: SendEmailParams): Promise<string | null> {
  const from = process.env['OUTBOUND_FROM_EMAIL'];
  if (!from) {
    throw new Error('OUTBOUND_FROM_EMAIL env var is required to send mail.');
  }

  // Local-dev convenience: when Postmark isn't configured, log instead of failing.
  if (!process.env['POSTMARK_SERVER_TOKEN'] && process.env['NODE_ENV'] !== 'production') {
    // eslint-disable-next-line no-console -- explicit dev-only escape hatch
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'email.dryrun',
        to: params.to,
        subject: params.subject,
      }),
    );
    return null;
  }

  const client = getPostmarkClient();
  const result = await client.sendEmail({
    From: from,
    To: params.to,
    Subject: params.subject,
    TextBody: params.textBody,
    ...(params.htmlBody ? { HtmlBody: params.htmlBody } : {}),
    MessageStream: params.messageStream ?? 'outbound',
  });
  return result.MessageID ?? null;
}
