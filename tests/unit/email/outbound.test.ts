/**
 * @file tests/unit/email/outbound.test.ts
 * @description Tests for the outbound Postmark wrapper. The Postmark SDK is
 *              vi-mocked so the suite never touches the network and runs
 *              without POSTMARK_SERVER_TOKEN.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendEmailMock = vi.fn();

vi.mock('postmark', () => ({
  ServerClient: vi.fn().mockImplementation(() => ({
    sendEmail: sendEmailMock,
  })),
}));

import { resetPostmarkClient, sendEmail } from '@/lib/email/outbound';

beforeEach(() => {
  sendEmailMock.mockReset();
  resetPostmarkClient();
});

afterEach(() => {
  delete process.env['POSTMARK_SERVER_TOKEN'];
  delete process.env['OUTBOUND_FROM_EMAIL'];
});

describe('sendEmail', () => {
  it('throws when OUTBOUND_FROM_EMAIL is unset', async () => {
    process.env['POSTMARK_SERVER_TOKEN'] = 'token';
    await expect(
      sendEmail({ to: 'jane@example.com', subject: 'hi', textBody: 'hello' }),
    ).rejects.toThrow(/OUTBOUND_FROM_EMAIL/);
  });

  it('returns null without calling Postmark in dev when token is unset', async () => {
    process.env['OUTBOUND_FROM_EMAIL'] = 'hello@scopeguard.app';
    const prev = process.env['NODE_ENV'];
    // Vitest runs with NODE_ENV=test by default, which is non-production.
    expect(prev !== 'production').toBe(true);

    const id = await sendEmail({ to: 'jane@example.com', subject: 'hi', textBody: 'hello' });
    expect(id).toBeNull();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('forwards to Postmark when token + from address are set', async () => {
    process.env['POSTMARK_SERVER_TOKEN'] = 'tok';
    process.env['OUTBOUND_FROM_EMAIL'] = 'hello@scopeguard.app';
    sendEmailMock.mockResolvedValueOnce({ MessageID: 'pm-123' });

    const id = await sendEmail({
      to: 'jane@example.com',
      subject: 'Verdict ready',
      textBody: 'OUT_OF_SCOPE',
    });

    expect(id).toBe('pm-123');
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        From: 'hello@scopeguard.app',
        To: 'jane@example.com',
        Subject: 'Verdict ready',
        TextBody: 'OUT_OF_SCOPE',
        MessageStream: 'outbound',
      }),
    );
  });

  it('passes htmlBody only when supplied (no undefined)', async () => {
    process.env['POSTMARK_SERVER_TOKEN'] = 'tok';
    process.env['OUTBOUND_FROM_EMAIL'] = 'hello@scopeguard.app';
    sendEmailMock.mockResolvedValueOnce({ MessageID: 'pm-456' });

    await sendEmail({
      to: 'jane@example.com',
      subject: 's',
      textBody: 't',
      htmlBody: '<p>t</p>',
    });

    const args = sendEmailMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(args['HtmlBody']).toBe('<p>t</p>');
  });

  it('respects a custom messageStream', async () => {
    process.env['POSTMARK_SERVER_TOKEN'] = 'tok';
    process.env['OUTBOUND_FROM_EMAIL'] = 'hello@scopeguard.app';
    sendEmailMock.mockResolvedValueOnce({ MessageID: 'pm-789' });

    await sendEmail({
      to: 'jane@example.com',
      subject: 's',
      textBody: 't',
      messageStream: 'broadcast',
    });

    const args = sendEmailMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(args['MessageStream']).toBe('broadcast');
  });
});
