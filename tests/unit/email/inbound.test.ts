/**
 * @file tests/unit/email/inbound.test.ts
 * @description Tests for the Postmark inbound helpers: signature
 *              verification, payload schema, and the to-event mapping.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  InboundPayloadSchema,
  toScopeEmailEvent,
  verifyPostmarkSignature,
} from '@/lib/email/inbound';
import {
  inboundEmailFull,
  inboundEmailHeaderForm,
  inboundEmailMalformed,
} from '@/tests/fixtures/postmark';

describe('verifyPostmarkSignature', () => {
  const SECRET = 'test-secret-12345';

  beforeEach(() => {
    process.env['POSTMARK_WEBHOOK_SECRET'] = SECRET;
  });
  afterEach(() => {
    delete process.env['POSTMARK_WEBHOOK_SECRET'];
  });

  it('accepts the exact configured secret', () => {
    expect(verifyPostmarkSignature(SECRET)).toBe(true);
  });

  it('rejects a different value of the same length', () => {
    expect(verifyPostmarkSignature(SECRET.replace('5', '6'))).toBe(false);
  });

  it('rejects values of different length', () => {
    expect(verifyPostmarkSignature(`${SECRET}x`)).toBe(false);
    expect(verifyPostmarkSignature(SECRET.slice(0, -1))).toBe(false);
  });

  it('rejects null header', () => {
    expect(verifyPostmarkSignature(null)).toBe(false);
  });

  it('rejects when the env var is unset', () => {
    delete process.env['POSTMARK_WEBHOOK_SECRET'];
    expect(verifyPostmarkSignature(SECRET)).toBe(false);
  });
});

describe('InboundPayloadSchema', () => {
  it('accepts a full Postmark payload and strips extra fields', () => {
    const result = InboundPayloadSchema.safeParse(inboundEmailFull);
    expect(result.success).toBe(true);
    if (!result.success) return;
    // .strip() means Headers / Attachments / etc. don't appear in output.
    expect(result.data).not.toHaveProperty('Headers');
    expect(result.data.MessageID).toBe(inboundEmailFull.MessageID);
  });

  it('rejects a payload missing MessageID', () => {
    const result = InboundPayloadSchema.safeParse(inboundEmailMalformed);
    expect(result.success).toBe(false);
  });
});

describe('toScopeEmailEvent', () => {
  it('uses StrippedTextReply when present (no quoted history)', () => {
    const parsed = InboundPayloadSchema.parse(inboundEmailFull);
    const event = toScopeEmailEvent(parsed);
    expect(event.bodyText).toBe(inboundEmailFull.StrippedTextReply);
    expect(event.bodyText).not.toMatch(/On 27 Apr Jane wrote/);
  });

  it('falls back to TextBody when StrippedTextReply is empty', () => {
    const parsed = InboundPayloadSchema.parse(inboundEmailHeaderForm);
    const event = toScopeEmailEvent(parsed);
    expect(event.bodyText).toBe(inboundEmailHeaderForm.TextBody);
  });

  it('extracts the email out of "Name <email>" form and lowercases', () => {
    const parsed = InboundPayloadSchema.parse(inboundEmailHeaderForm);
    const event = toScopeEmailEvent(parsed);
    expect(event.fromEmail).toBe('pm@acme.example');
    expect(event.toAlias).toBe('jane-7a2b9f1c@inbound.scopeguard.app');
  });

  it('preserves the Postmark MessageID for idempotency', () => {
    const parsed = InboundPayloadSchema.parse(inboundEmailFull);
    const event = toScopeEmailEvent(parsed);
    expect(event.postmarkMessageId).toBe(inboundEmailFull.MessageID);
  });

  it('lowercases addresses for case-insensitive comparison', () => {
    const parsed = InboundPayloadSchema.parse({
      ...inboundEmailFull,
      FromFull: { Email: 'PM@ACME.EXAMPLE' },
      ToFull: [{ Email: 'JANE-7A2B9F1C@INBOUND.SCOPEGUARD.APP' }],
    });
    const event = toScopeEmailEvent(parsed);
    expect(event.fromEmail).toBe('pm@acme.example');
    expect(event.toAlias).toBe('jane-7a2b9f1c@inbound.scopeguard.app');
  });
});
