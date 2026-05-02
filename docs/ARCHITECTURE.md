# Architecture

How the pieces of ScopeGuard fit together. Read this before opening a PR that touches more than one module.

---

## At a glance

ScopeGuard is a single Next.js 14 monolith (App Router) deployed on Vercel, talking to:

- **Supabase** for Postgres + Auth + Storage + Realtime.
- **Anthropic Claude** for contract parsing, scope verdicts, and expense categorisation.
- **Postmark** for inbound email (forwarded client emails) and outbound transactional mail.
- **Stripe** for subscription billing AND for Connect-style transaction sync.
- **PayPal + Plaid** for additional transaction sync.
- **Inngest** for every background job (no Vercel cron — Inngest schedules itself).
- **Upstash Redis** for sliding-window rate limits.
- **Sentry + PostHog** for observability.

There is **no separate API layer**. Server components query Prisma directly; client components POST to App Router route handlers; webhooks are App Router routes too.

---

## Two product modules

The codebase has two distinct functional areas. Their data shapes overlap (`User`, `Project`) but the AI flows are independent.

### 1. Scope enforcement

```
                     ┌────────────────────┐
                     │  User uploads      │
                     │  contract (PDF)    │
                     └─────────┬──────────┘
                               │
                               ▼
              ┌─────────────────────────────┐
              │ POST /api/contracts          │
              │ • auth + rate limit          │
              │ • upload to Supabase Storage │
              │ • prisma.contract.create     │
              │ • inngest.send(             │
              │     'contract/uploaded')    │
              └─────────────┬───────────────┘
                            │
                            ▼ (async)
              ┌─────────────────────────────┐
              │ Inngest:                    │
              │ parseUploadedContract        │
              │ • download from Storage      │
              │ • extract text (pdf-parse)   │
              │ • parseContract (Claude)     │
              │ • prisma.contract.update     │
              │   set parsedAt = now()       │
              │ • inngest.send(             │
              │     'contract/parsed')      │
              └─────────────────────────────┘


  Client forwards email to                         ┌────────────────────────┐
  jane-abc123@inbound.scopeguard.app               │ Postmark webhook        │
                  │                                │ POST /api/webhooks/     │
                  │                                │ postmark                 │
                  │                                │ • IP rate limit          │
                  ▼                                │ • signature verify       │
       Postmark inbound parsing                    │ • inngest.send(         │
                  │                                │   'scope/email.received')│
                  └──────────────────────────────► └─────────────┬───────────┘
                                                                 │
                                                                 ▼ (async)
                              ┌──────────────────────────────────────────────┐
                              │ Inngest: processInboundEmail                  │
                              │ • lookup user by inbound alias                │
                              │ • match project by clientEmail                │
                              │ • load latest contract;                       │
                              │   step.waitForEvent('contract/parsed', 15m)   │
                              │   if parsedAt is null                         │
                              │ • checkScope (Claude tool_use)                │
                              │ • prisma.scopeCheck.create                    │
                              │ • inngest.send('scope/check.completed')       │
                              └────────────────────────┬─────────────────────┘
                                                       │
                                                       ▼ (async)
                              ┌──────────────────────────────────────────────┐
                              │ Inngest: notifyUserOfVerdict                  │
                              │ • Postmark sendEmail with verdict + cited    │
                              │   clause + drafted reply + change order      │
                              └──────────────────────────────────────────────┘

                              ▲ INSERT on scope_checks fires Realtime ▲
                              │                                       │
                              └─── /inbox subscribes via Supabase     │
                                  Realtime → router.refresh() ────────┘
```

**Race resolution**: when a forwarded email arrives BEFORE the AI finishes parsing the contract (common during the first session), `processInboundEmail` calls `step.waitForEvent('contract/parsed', { timeout: '15m', if: 'event.data.contractId == "<id>"' })`. On timeout it falls through to a skeleton ParsedContract so the user still gets an AMBIGUOUS verdict — never silent failure.

### 2. Financial OS (PRO+)

```
  Manual entry              Stripe Connect / PayPal / Plaid
  ────────────              ──────────────────────────────
       │                                  │
       │                                  │
       ▼                                  ▼
  POST /api/finances/                Inngest:
  transactions                       syncIntegrationOnConnect
  • plan-gate (PRO+)                 (or hourly cron fan-out)
  • prisma.transaction               • driver.syncTransactions
    .create                          • upsert by (source, externalId)
  • if EXPENSE no                    • for each new EXPENSE w/o category:
    category, send                     send 'transaction/created'
    'transaction/created'                     │
                                              ▼
                                Inngest: categorizeTransaction
                                • categorizeExpense (Claude tool_use)
                                • prisma.transaction.update
                                  set category, taxDeductible
                                              │
                                              ▼
                                ┌─────────────────────────────┐
                                │ /finances dashboard          │
                                │ • SummaryCards (per currency)│
                                │ • CategoryBreakdown           │
                                │ • TaxEstimateCard             │
                                │   (US/CA/UK estimator)       │
                                └─────────────────────────────┘
```

---

## Request lifecycle

Every authenticated request follows the same path:

```
Browser → Next.js middleware (auth gate)
       → Route handler / Server Component
       → requireCurrentUser() → Supabase SSR client → reads sb-* cookies
       → Plan-gate check (if behind a paid feature)
       → Per-user rate limit (Upstash sliding window)
       → Business logic (Prisma + AI + Inngest)
       → Structured logger.info/warn/error
                            │
                            └─► Sentry breadcrumb (auto-bridged)
                            └─► Sentry captureMessage on warn/error
       → JSON response
```

Webhook requests differ:

```
Provider → Route handler
        → IP rate limit (FIRST — before signature verify, body parse, etc.)
        → Signature verification (HMAC, constant-time compare)
        → Body validation (Zod)
        → Always 200 in <5s; offload heavy work via inngest.send(...)
```

---

## Idempotency

| Surface | Key |
| --- | --- |
| Postmark inbound webhook | Inngest event `id = postmarkMessageId` — duplicates rejected by Inngest before any handler runs. |
| Stripe webhook events | Handlers are deterministic "set state from event payload" — replays are no-ops. |
| AI categorisation Inngest function | Short-circuits when `tx.category !== null` (already-set check). |
| Transaction sync upsert | Composite-unique `(source, externalId)` — re-syncs never duplicate rows. |
| Integration connect | Per-user `(userId, source)` upsert key — re-connecting overwrites tokens cleanly. |

---

## Auth invariants

- `User.id == Supabase auth.users.id` (always). RLS policies use `auth.uid()` directly.
- The public `users` row is provisioned by `ensureUserProfile` inside the auth callback (race-safe upsert that catches the unique-constraint conflict).
- Subscription columns (`stripeSubscriptionId`, `stripePriceId`, `subscriptionStatus`, `currentPeriodEnd`, `planTier`) are mutated EXCLUSIVELY by `app/api/webhooks/stripe/route.ts`. Application code reads them but never writes.

---

## Plan limits

Two enforcement points:

1. `createProjectAction` — calls `checkActiveProjectLimit(user)` BEFORE `prisma.project.create`. Returns an actionable error string when at cap.
2. `POST /api/scope/check` — calls `checkScopeCheckLimit(user)` after IP rate-limiting but BEFORE the AI call. Returns HTTP 402 `PLAN_LIMIT_EXCEEDED` with `{ upgradeTo, usage, limit }`.

The Postmark inbound pipeline (`processInboundEmail`) intentionally does NOT enforce the scope-check cap — paying customers must never silently drop a real client email. Over-limit usage is billed-but-allowed and surfaced in the dashboard.

---

## Encryption + secrets

- All OAuth tokens persisted in `Integration.accessToken` / `refreshToken` are **AES-256-GCM ciphertext** via `lib/utils/encryption.ts`. Never log these columns. Never return them from any API route.
- `ENCRYPTION_KEY` (64 hex chars) doubles as the HMAC key for the OAuth state-token CSRF in `lib/integrations/state.ts` (signed `<base64url-payload>.<base64url-hmac>` tokens, 10-min TTL, source-binding prevents replay across providers).
- `STRIPE_WEBHOOK_SECRET` and `POSTMARK_WEBHOOK_SECRET` are HMAC-verified on every webhook request via `timingSafeEqual` to defeat timing attacks.

---

## RLS

Every `userId`-bearing table has Row Level Security enabled with explicit `SELECT/INSERT/UPDATE/DELETE` policies keyed off `auth.uid()`. Project-owned tables (`contracts`, `scope_checks`) join through `projects`. The `scope_checks` table intentionally has NO `DELETE` policy — the verdict log is append-only for audit purposes.

The Supabase service-role key bypasses RLS — only used in:

- `lib/supabase/server.ts → createSupabaseAdminClient()`
- Webhook handlers that need cross-user lookups (Postmark inbound by alias).
- `lib/contracts/storage.ts` for Storage operations (the user gets signed URLs, never direct paths).

---

## Background jobs

All async work goes through Inngest — no Vercel cron, no setInterval, no in-process queues.

| Event | Triggered by | Function |
| --- | --- | --- |
| `contract/uploaded` | `POST /api/contracts` | `parseUploadedContract` |
| `contract/parsed` | `parseUploadedContract` after save | (await target for `processInboundEmail`) |
| `scope/email.received` | `POST /api/webhooks/postmark` | `processInboundEmail` |
| `scope/check.completed` | `processInboundEmail` after save | `notifyUserOfVerdict` |
| `transaction/created` | `POST /api/finances/transactions` (when EXPENSE without category) | `categorizeTransaction` |
| `integration/connected` | OAuth callback OR cron fan-out | `syncIntegrationOnConnect` |
| `cron/sync-transactions.tick` | Inngest schedule (hourly) | `syncIntegrationsHourly` (fans out per-integration events) |

Concurrency: per-resource jobs (parse one contract, sync one integration) use `concurrency: { key: 'event.data.<id>', limit: 1 }` so two events for the same resource never race.

Idempotency: every function is either keyed on a globally-unique provider ID or short-circuits when its target state is already reached.

---

## Observability stack

```
Application code
       │
       ├─ logger.info('foo', { ... })
       │       │
       │       ├─ console.warn(JSON.stringify(line))   ──► Vercel Logs
       │       └─ Sentry.addBreadcrumb('logger', ...)  ──► Sentry breadcrumb trail
       │
       ├─ logger.warn('foo.degraded', { ... })
       │       │
       │       ├─ console.warn(...)
       │       ├─ Sentry.addBreadcrumb(...)
       │       └─ Sentry.captureMessage('foo.degraded', 'warning')
       │
       ├─ logger.error('foo.failed', { ... })
       │       │
       │       ├─ console.error(...)
       │       ├─ Sentry.addBreadcrumb(...)
       │       └─ Sentry.captureMessage('foo.failed', 'error')
       │
       └─ throw new Error(...)  ──► error boundary  ──► Sentry.captureException
```

PostHog is separate — manual `captureEvent` calls from server code (`lib/observability/posthog.ts`) and automatic `$pageview` from the client provider on App Router route changes.

See [`adr/004-observability.md`](adr/004-observability.md) for the full strategy and PII handling rules.

---

## How to add a new module

1. Add an enum value in `prisma/schema.prisma` if you need one.
2. Create the migration: `pnpm prisma:migrate` and review the generated SQL.
3. Add RLS policies in the SAME migration file if the new table carries `userId`.
4. Update `docs/schema.md` in the same PR.
5. Implement the lib layer under `lib/<module>/`.
6. Implement the API routes under `app/api/<module>/`.
7. Implement the UI under `app/(dashboard)/<module>/` + `components/<module>/`.
8. Add unit tests under `tests/unit/<module>/`.
9. Add at least one Playwright spec under `tests/e2e/{public,auth}/<module>.spec.ts`.
10. Update `docs/openapi.yaml` for new endpoints.
11. Update `docs/CHANGELOG.md` and the source-tree commentary in `docs/README.md`.
