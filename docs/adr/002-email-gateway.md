# ADR 002 — Email gateway: Postmark for both inbound and outbound

- **Status:** Accepted
- **Date:** 2026-04-27
- **Decider:** Founding engineer
- **Supersedes:** —
- **Superseded by:** —

## Context

Inbound email is the entry point for ScopeGuard's core value proposition: a freelancer forwards a client message to their personal alias and gets a verdict back. Reliability and parsing accuracy here directly determine whether the product feels magical or flaky.

Requirements:

1. **Inbound parsing**: receive `*@inbound.scopeguard.app`, parse plain text + HTML reliably (including forwarded chains, signatures, and attachments).
2. **Webhook delivery**: notify our backend within seconds.
3. **Outbound transactional email**: signup confirmations, weekly scope-report digest, billing notifications.
4. **DNS / DKIM**: a single provider that can sign as us for outbound and accept inbound on a separate subdomain.
5. **Cost**: under $50/month at <10k messages/month.

## Decision

Use **Postmark** for both inbound parsing and outbound transactional email. Inbound webhook fires `POST /api/webhooks/postmark` with the parsed payload. Webhook signature is validated against `POSTMARK_WEBHOOK_SECRET`.

The handler returns `200` synchronously and publishes an Inngest event (`scope/email.received`) for actual processing — the webhook itself never blocks on AI calls.

## Consequences

### Positive

- One vendor for inbound + outbound. Simpler DNS, single dashboard.
- Postmark inbound parses MIME accurately and exposes `StrippedTextReply` (reply-only body) which is exactly what we want to feed Claude.
- Postmark's outbound deliverability reputation is strong (transactional-only sender pool).
- Pricing predictable: $1.25 per 1000 emails (outbound), inbound included.

### Negative

- Postmark is not a marketing platform — if we ever need broadcast/campaign email, that's a separate vendor (Resend, Customer.io). Out of scope for the freelancer audience.
- Single-vendor risk on the inbound channel. Mitigation: persist raw inbound payload in Storage so we can replay if the webhook handler had a bug; Postmark itself has an "Activity" log we can manually export.

## Alternatives considered

- **SendGrid Inbound Parse + SendGrid:** Workable, but SendGrid's reputation has degraded for transactional senders sharing IPs with marketers. Postmark's transactional-only stance is the right architectural fit.
- **AWS SES + custom MX + ParseEmail Lambda:** Cheapest at scale but adds a Lambda to maintain and SES MIME parsing is bring-your-own-library. The savings don't justify the maintenance burden in year one.
- **Resend (outbound) + ImprovMX (inbound forwarding):** ImprovMX is forwarding-only, not parsing-with-webhook. Splitting providers also doubles DNS surface.

## Operational notes

- Always validate `X-Postmark-Signature` (HMAC-SHA1 of body with the webhook secret).
- Always return 200 within 5 seconds, even if downstream processing fails. Retries are handled by Inngest, not by Postmark.
- See `docs/RUNBOOK.md` § "Investigating a Postmark inbound failure" for triage.
