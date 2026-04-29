/**
 * @file tests/fixtures/postmark.ts
 * @description Realistic Postmark inbound payload fixtures. Trimmed from
 *              actual Postmark webhook payloads — extra fields (Headers,
 *              Attachments, MailboxHash, etc.) are present so the schema's
 *              `.strip()` ignore-extras behaviour is exercised by the tests.
 */

/** Standard inbound — explicit StrippedTextReply, FromFull, ToFull. */
export const inboundEmailFull = {
  FromName: 'Acme PM',
  MessageStream: 'inbound',
  From: 'pm@acme.example',
  FromFull: { Email: 'pm@acme.example', Name: 'Acme PM', MailboxHash: '' },
  To: 'jane-7a2b9f1c@inbound.scopeguard.app',
  ToFull: [
    {
      Email: 'jane-7a2b9f1c@inbound.scopeguard.app',
      Name: '',
      MailboxHash: '',
    },
  ],
  Cc: '',
  Bcc: '',
  OriginalRecipient: 'jane-7a2b9f1c@inbound.scopeguard.app',
  Subject: 'Quick add — customer login',
  MessageID: '73e6d360-66eb-11ee-8c99-0242ac120002',
  ReplyTo: '',
  MailboxHash: '',
  Date: 'Mon, 28 Apr 2026 14:31:11 +0000',
  TextBody:
    'Hey Jane, also can you add a customer login system before launch? Should be quick.\n\nOn 27 Apr Jane wrote:\n> Original message',
  HtmlBody: '<p>Hey Jane…</p>',
  StrippedTextReply:
    'Hey Jane, also can you add a customer login system before launch? Should be quick.',
  Tag: '',
  Headers: [{ Name: 'X-Spam-Status', Value: 'No' }],
  Attachments: [],
} as const;

/** Inbound with header-style "Name <email>" From address and no FromFull. */
export const inboundEmailHeaderForm = {
  From: 'Acme PM <pm@acme.example>',
  To: '<jane-7a2b9f1c@inbound.scopeguard.app>',
  Subject: 'Re: Pricing tweak',
  MessageID: '94f7e480-66eb-11ee-8c99-0242ac120002',
  TextBody: 'Move the testimonials block above the feature grid please.',
  HtmlBody: '<p>Move the testimonials block above the feature grid please.</p>',
  StrippedTextReply: '',
} as const;

/** Inbound that fails schema — missing required MessageID. */
export const inboundEmailMalformed = {
  From: 'pm@acme.example',
  To: 'jane-7a2b9f1c@inbound.scopeguard.app',
  Subject: 'oops',
  TextBody: 'no MessageID',
} as const;
