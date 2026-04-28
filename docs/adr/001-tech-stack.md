# ADR 001 — Initial tech stack

- **Status:** Accepted
- **Date:** 2026-04-27
- **Decider:** Founding engineer
- **Supersedes:** —
- **Superseded by:** —

## Context

We are building ScopeGuard from a cold start. The product spans:

- Authenticated SaaS dashboard for freelancers (server-rendered).
- AI inference (Claude) on contract text and inbound emails.
- Inbound email ingestion at low latency (under a minute end-to-end).
- Subscription billing.
- Financial integrations (OAuth flows, periodic data sync).

Hard requirements:

1. Two engineers must be able to ship features without becoming infrastructure specialists.
2. Per-user data isolation must be enforced at the database layer, not just in app code.
3. Latency for the scope-check pipeline must hold under load (queueing + retries).
4. Time-to-prod must be measured in weeks, not quarters.

## Decision

| Layer            | Choice                                                |
| ---------------- | ----------------------------------------------------- |
| Web framework    | Next.js 14 App Router (React 18, RSC, Edge runtime where useful) |
| Language         | TypeScript with strictest reasonable flags            |
| Database         | PostgreSQL via Supabase (managed)                     |
| ORM              | Prisma                                                |
| Auth             | Supabase Auth                                         |
| File storage     | Supabase Storage                                      |
| AI               | Anthropic Claude (see ADR-003)                        |
| Inbound email    | Postmark (see ADR-002)                                |
| Background jobs  | Inngest                                               |
| Payments         | Stripe + Stripe Connect                               |
| Rate limiting    | Upstash Redis (`@upstash/ratelimit`)                  |
| UI               | Tailwind CSS + shadcn/ui                              |
| Testing          | Vitest (unit) + Playwright (E2E)                      |
| Errors           | Sentry                                                |
| Analytics        | PostHog                                               |
| Hosting          | Vercel (web) + Supabase (db + storage + auth)         |
| CI               | GitHub Actions                                        |

## Consequences

### Positive

- Supabase + Vercel collapse "deploy a database, deploy a queue, deploy auth" into single-click managed services. Lets a small team ship a vertically integrated product fast.
- Postgres + Prisma keeps the data model relational and migration-checked. RLS pushes authorization into the database, which is the only place it cannot be accidentally bypassed by a missing app-level check.
- Inngest replaces hand-rolled cron + queue. Idempotency, retries, and observability are first-class.
- Next.js gives us SSR for authed dashboards (latency + SEO of marketing pages from the same codebase).
- shadcn/ui provides a consistent, accessible component baseline without a UI vendor lock-in.

### Negative

- Vendor concentration: Supabase outage cascades to db + auth + storage at once. Mitigation: Postgres dump nightly to S3; auth is stateless given JWTs.
- Inngest pricing ramps with event volume; at >5M events/month a self-hosted alternative (BullMQ on Upstash, e.g.) may be cheaper. Re-evaluate at that threshold.
- Anthropic API has a single supplier risk for the core differentiator. Tracked separately in ADR-003.
- React Server Components add one more concept to debug; documented in onboarding guide.

## Alternatives considered

- **Supabase vs. Neon + Clerk + Vercel Blob:** Neon's branching is attractive for staging environments, but Clerk auth + Neon + Blob is three vendors instead of one. The ergonomic loss outweighs the branching gain at this stage.
- **Inngest vs. Trigger.dev vs. BullMQ:** Trigger.dev is comparable; we chose Inngest for the typed event schemas (`EventSchemas` integration with TS types). BullMQ requires running and monitoring our own Redis worker pool — out of scope for a 1-2 person team.
- **Prisma vs. Drizzle:** Drizzle's SQL-first ergonomics are tempting, but Prisma's migration tooling and ecosystem maturity matter more in year one.

## Open questions

- Whether to introduce tRPC for typed API contracts. Deferred — Next.js Route Handlers + Zod-validated bodies are sufficient until the API surface grows past ~30 routes.
