# ADR 004 — Observability: Sentry + PostHog + structured logger

- **Status:** Accepted
- **Date:** 2026-05-01
- **Decider:** Founding engineer
- **Supersedes:** —
- **Superseded by:** —

## Context

Production traffic exposes failure modes the unit + E2E suites cannot. We need three signals:

1. **Errors** — every unhandled exception in a route handler, server action, server component render, or background job, with enough context (user id, request path, breadcrumb trail) to reproduce.
2. **Product analytics** — what users actually do (which CTA they clicked, where they drop off, conversion funnel from signup → first verdict → first paid plan).
3. **Structured operational logs** — high-cardinality events (`scope.check.completed`, `stripe.webhook.event_handled`) for ad-hoc debugging and per-user audit trails.

The instrumentation must:

- Survive missing env vars (developers without DSNs must still be able to run the app).
- Never block the request path on the observability provider.
- Never leak tokens, PII, or contract content to a third-party.
- Layer on top of the existing `lib/utils/logger.ts` rather than replacing it.

## Decision

We use a three-tier observability stack:

| Tier | Tool | Wired by |
| --- | --- | --- |
| Errors | **Sentry** (`@sentry/nextjs`) | `instrumentation.ts` + `sentry.{client,server,edge}.config.ts` + per-boundary `captureException` calls in `app/error.tsx`, `app/global-error.tsx` |
| Product analytics | **PostHog** | `components/observability/PostHogProvider.tsx` (browser) + `lib/observability/posthog.ts` (server-side `captureEvent`) |
| Operational logs | **`lib/utils/logger.ts`** (existing structured JSON logger) | Bridges automatically to Sentry breadcrumbs (info/warn) and Sentry messages (warn/error) when `SENTRY_DSN` is set |

### Sample rates

- **Errors:** 100% (all exceptions captured).
- **Performance traces:** 5% production, 100% dev. Performance traces aren't load-bearing for the product yet — we'd rather burn quota on errors.
- **Session replays:** 0% sessions, 100% on-error. Recording every session is overkill at our user count.

### PII handling

- Sentry server SDK runs with `sendDefaultPii: false`. Request bodies are NEVER attached to error events.
- The structured logger redacts any field whose key matches `/token|secret|password|api[-_]?key|access[-_]?token|refresh[-_]?token|encryption[-_]?key/i` BEFORE the log is emitted, which means anything bridged to a Sentry breadcrumb is also redacted.
- Contract text and email content are never logged with anything more than a hash / size summary. The audit trail (raw email + verdict) lives in Postgres under RLS, not in Sentry/PostHog.

### Scope of PostHog identification

- We `identify(user.id, { planTier })` once per session, never with email or other PII.
- `person_profiles: 'identified_only'` so anonymous landing-page traffic doesn't create profiles.

## Why not …

### Why not OpenTelemetry?

Setting up an OTel collector + Honeycomb/Datadog backend is the right answer for a multi-service architecture. ScopeGuard is a monolith on Vercel — Sentry's distributed tracing is sufficient through Pro tier, and PostHog covers funnels. Revisit when we add a second service.

### Why not just structured logs to Vercel?

Vercel's log retention is short (hours to days depending on plan), grouping is poor, and there's no UX for assigning errors to engineers. Sentry's issue grouping + assignment is load-bearing once any team member needs to triage. We KEEP the structured logger because it's the audit trail and bridge — Sentry sees a subset.

### Why not Datadog RUM for product analytics?

PostHog's funnel analysis + open-source self-host fallback is a better cost/feature trade-off at our user count. Datadog RUM is enterprise-priced; PostHog Cloud's free tier is generous.

## Consequences

- **Three new packages** to install at deploy time: `@sentry/nextjs`, `posthog-js`, `posthog-node`. The dynamic-import wrappers gracefully no-op when those packages aren't installed (so `pnpm test` still works without them).
- **CSP gets four new domains** (`*.ingest.sentry.io`, `*.posthog.com`, `cdn.plaid.com`, `api-m.paypal.com`) — all explicitly allowlisted in `next.config.ts`.
- **`logger.error(...)` automatically captures to Sentry** as a `captureMessage('error')`. Call sites that want richer context (an actual `Error` object) should use `captureException(err, { … })` from `lib/observability/sentry.ts` instead.
- **CI builds without Sentry credentials** still pass — the wrapper detects the missing DSN and short-circuits.
- **Client bundle size** grows by ~20-30 KB gzipped from PostHog + Sentry browser SDKs. Both are dynamic-imported in our wrappers so the cost is paid only when DSNs are configured.
