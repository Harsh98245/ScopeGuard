# Changelog

All notable changes to ScopeGuard are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Documentation pass (2026-05-02 — final session)

- Build Order step 13: full documentation refresh now that the codebase has stabilised.
- `docs/ARCHITECTURE.md` (new) — module map, ASCII request-flow diagrams for both product modules (scope enforcement + Financial OS), the standard authenticated request lifecycle, the webhook lifecycle, idempotency-key matrix, auth invariants, plan-limit enforcement points, encryption + RLS boundaries, the complete Inngest event ↔ function table, observability data-flow diagram, and a step-by-step "how to add a new module" runbook.
- `docs/README.md` rewritten — was a 13-line stub; now a full file-by-file source-tree commentary covering every directory under `app/`, `components/`, `lib/`, `inngest/`, `prisma/`, `tests/`, plus the root configuration files. Lists all four ADRs with one-line explanations of when to read each.
- `docs/schema.md` updated — added the four subscription columns introduced in session 8 (`stripeSubscriptionId`, `stripePriceId`, `subscriptionStatus`, `currentPeriodEnd`) with the constraint that they're mutated EXCLUSIVELY by `app/api/webhooks/stripe/route.ts`.
- `README.md` (root) Build Order section fixed — the original had duplicated entries for steps 5–7 and read as if step 7 was still "next"; rewritten as a clean "all 13 done" checklist with a pointer to ARCHITECTURE.md and CHANGELOG.md.

### Added (2026-05-01 — Production hardening session)

- Build Order step 12: Sentry + PostHog observability, IP-based webhook rate limits, deep health check, Vercel function tuning, CSP coverage for the new providers.
- `instrumentation.ts` — Next.js `register()` hook that loads `sentry.server.config.ts` (Node) or `sentry.edge.config.ts` (Edge) on cold-start, plus an `onRequestError` hook for rich server-component error context. No-op when `SENTRY_DSN` is unset.
- `sentry.client.config.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts` — distinct SDK configs per runtime. `enabled: !!SENTRY_DSN` so missing-DSN environments skip cleanly. Sample rates: errors 100%, perf traces 5% prod / 100% dev / 2% edge. Dev events drop unless `SENTRY_DEBUG=1` so iteration doesn't spam the project.
- `lib/observability/sentry.ts` — server-only adapter exposing `captureException`, `captureMessage`, `addBreadcrumb`, `setSentryUser`. Lazy `await import('@sentry/nextjs')` keeps the bare logger free of any Sentry import; absence of the package or DSN drops to a no-op adapter.
- `lib/observability/posthog.ts` — server-only PostHog wrapper using `posthog-node`. `flushAt: 1` so dev events surface in real time. Same lazy-import + no-op-without-key pattern.
- `components/observability/PostHogProvider.tsx` — client island. Bootstraps `posthog-js` once, fires `$pageview` on App Router route changes (the SDK's auto-pageview misses RSC navigations), identifies the user when `distinctId` is supplied. Reads `NEXT_PUBLIC_POSTHOG_KEY`; absent ⇒ no-op.
- `lib/utils/logger.ts` updated — `emit()` now invokes `bridgeToSentry(level, msg, redactedFields)` after writing the JSON line. info/warn become Sentry breadcrumbs; warn/error also fire `captureMessage`. Bridge is browser-guarded (`typeof window`) and try/catch'd around the dynamic import so absence of `@sentry/nextjs` is harmless.
- `app/error.tsx` rewritten — per-route boundary that captures the error to Sentry on mount via dynamic import (graceful when SDK absent), shows `error.digest` for support reference.
- `app/global-error.tsx` (new) — last-resort root-layout error boundary. Includes its own `<html>`/`<body>` (no parent layout left). Same Sentry capture pattern with `tags: { boundary: 'global' }`.
- `lib/utils/ipRateLimit.ts` — three new per-IP sliding-window limiters: `postmarkInboundLimiter` (600/h), `stripeWebhookLimiter` (1000/h), `oauthCallbackLimiter` (30/h). `getClientIp(request)` honours `x-forwarded-for` then `x-real-ip` then falls back to `'unknown'` so a missing header bucket-bombs into one key (still rate-limited, just less granular).
- IP rate limits applied to:
  - `app/api/webhooks/postmark/route.ts` — runs BEFORE signature verification so flood traffic stops at the limiter, never burning crypto cycles.
  - `app/api/webhooks/stripe/route.ts` — runs BEFORE the `request.text()` body read so we don't waste CPU parsing forged payloads.
  - `app/api/integrations/[source]/callback/route.ts` — bounces OAuth code-replay + scanner traffic (legit users only hit this once per connect).
- `app/api/health/route.ts` rewritten — dual-mode liveness/readiness probe.
  - `GET /api/health` → simple `{ ok: true, version }` (200 always — used by Vercel's platform health check).
  - `GET /api/health?deep=1` → checks Postgres (`select 1`), Upstash (`PING`), required env vars (NEXT_PUBLIC_SUPABASE_URL, ANTHROPIC_API_KEY, ENCRYPTION_KEY, etc.). Returns 503 when any check fails so external uptime monitors can pull instances from rotation.
- `vercel.json` — function-level `maxDuration` tuning so the AI-heavy routes (scope check, contracts, Inngest serve) get the seconds they need; webhook handlers stay tight (5–10s) so a slow handler never blocks Stripe/Postmark retries.
- `next.config.ts` CSP extended:
  - `script-src` + `frame-src` + `img-src` add `https://cdn.plaid.com`.
  - `connect-src` adds `https://*.plaid.com`, `https://api-m.paypal.com`, `https://api-m.sandbox.paypal.com`.
  - Sentry + PostHog domains were already allowlisted from the scaffold session.
- `docs/adr/004-observability.md` — captures the three-tier strategy (Sentry / PostHog / structured logger), sample-rate rationale, PII handling rules, why-not alternatives (OpenTelemetry, raw Vercel logs, Datadog RUM).
- `.env.example` — added `POSTHOG_API_KEY` (server-side analytics).

**Install-time follow-up**: `pnpm add @sentry/nextjs posthog-js posthog-node` to activate the wrappers. Until installed, every observability call is a graceful no-op — the test suite, dev server, and CI build all pass without those packages.

### Added (2026-05-01 — E2E suite session)

- Build Order step 11: Playwright E2E suite covering the critical user flows. Two-project layout splits hermetic public-surface specs from authenticated specs that need a live Supabase instance.
- `tests/e2e/fixtures/auth.ts` — `ensureTestUser`, `deleteTestUser`, `setUserPlanTier`. Uses `@supabase/supabase-js` with the service-role key to provision a stable `e2e-user@scopeguard.test` account, idempotently re-used across runs. The setUserPlanTier helper lets plan-gate specs flip the test user between FREE/STARTER/PRO/BUSINESS without going through Stripe.
- `tests/e2e/fixtures/seed.ts` — `seedProject`, `seedScopeCheck`, `seedTransaction`. Insert rows directly via the Supabase REST API so specs can assert against IDs without driving the AI pipeline. Manual transactions get a synthetic `e2e:<uuid>` external ID to satisfy the `(source, externalId)` unique constraint.
- `tests/e2e/fixtures/mocks.ts` — Playwright `page.route()` interceptors: `mockManualScopeCheck` (Anthropic-free deterministic verdict), `mockBillingCheckout` + `mockBillingPortal` (intercept `/api/billing/*` AND `https://checkout.stripe.com/**` so tests never leave the app), `mockStripeConnectStart` (fake OAuth URL).
- `tests/e2e/global-setup.ts` — runs once before any spec. Provisions the test user, drives a real `/login` submission (so the public users row + SSR session cookies are populated by the same code path users hit), persists `storageState` to `tests/e2e/.auth/user.json`, and resets the user's plan back to FREE. Soft-skips with a friendly warning when Supabase admin env vars are missing.
- `playwright.config.ts` updated with `globalSetup`, two project shapes:
  - `chromium-public` (testDir `tests/e2e/public/`, no storageState — runs hermetically in CI).
  - `chromium-auth` (testDir `tests/e2e/auth/`, uses persisted storageState).
  - `firefox-public` + `webkit-public` register only when `CI=true` so local iteration stays fast.
- Public specs (`tests/e2e/public/`):
  - `landing.spec.ts` — landing page renders an h1 and signup CTA, doesn't leak protected paths via prefetch, returns custom 404 for unknown routes, `/api/health` returns 200.
  - `auth-forms.spec.ts` — login form fields + Google OAuth button + signup link, signup form captures browser timezone in a hidden input (regression guard against stripping that wiring), middleware redirects `/projects` and `/finances` to `/login` when unauthenticated.
- Authenticated specs (`tests/e2e/auth/`, all soft-skip when storageState missing):
  - `projects.spec.ts` — full project creation flow (`/projects/new` → fill form → land on detail page).
  - `scope-check.spec.ts` — manual scope check with mocked AI, asserts inline verdict card + cited clause + copy buttons.
  - `inbox.spec.ts` — seeds two scope checks, asserts both render with their email subjects.
  - `billing.spec.ts` — pricing table renders all 3 tiers, Upgrade button posts to `/api/billing/checkout` and follows the (mocked) Stripe URL, success/cancelled banners render off `?checkout=`.
  - `plan-gate.spec.ts` — flips planTier between FREE/STARTER/PRO and asserts the upgrade card on `/finances` and `/settings/integrations` for non-PRO users vs the dashboard for PRO.
  - `finances.spec.ts` — promotes user to PRO, seeds 2 incomes + 1 deductible expense, asserts `$7,500.00 / $120.00 / $7,380.00` headline numbers and the recent activity table.
  - `integrations.spec.ts` — three driver cards visible, each has a Connect button, Stripe Connect button posts and follows the mocked OAuth URL, success/error banners render off `?connected=` / `?error=`.
- `tests/e2e/README.md` — full run instructions: prerequisites, env vars, local commands, mocked-vs-live external services table, test-data hygiene SQL, "how to add a new spec" rules.
- `.github/workflows/ci.yml` — new `e2e` job runs after `build`. Installs Playwright browsers (chromium + firefox + webkit), runs the public-only project subset (the auth specs require a live Supabase preview which lands in the deploy workflow), uploads the HTML report on failure.

### Added (2026-04-30 — Integrations session)

- Build Order step 10: integration framework + drivers for Stripe Connect, PayPal, and Plaid. All three drivers are wired end-to-end through a provider-agnostic registry, OAuth state CSRF, encrypted token storage, and a single Inngest sync function.
- `lib/integrations/types.ts` — provider-agnostic contract: `IntegrationDriver<ConnectInput>` with `connectStartUrl`, `handleCallback`, `syncTransactions`, optional `revokeAccess`. `NormalisedTransaction` is the cross-provider shape every driver emits so the sync function can persist with one upsert key (`source` + `externalId`).
- `lib/integrations/state.ts` — HMAC-SHA256 signed state tokens (`<base64url-payload>.<base64url-hmac>`), keyed off `ENCRYPTION_KEY`. 10-minute TTL with constant-time comparison via `timingSafeEqual`. Embeds `userId`, `source`, `nonce`, `exp` so a callback for source X can never be replayed against source Y.
- `lib/integrations/registry.ts` — single source of truth for source → driver mapping. `getDriver(source)` returns null for unsupported sources (GUMROAD, SHOPIFY, ETSY, UPWORK, WISE — reserved for future drivers). `describeDrivers()` returns lightweight `DriverDescriptor[]` for the UI without forcing a full driver import.
- `lib/integrations/stripe.ts` — Stripe Connect (Standard) driver. Uses platform secret key + `stripe.oauth.token` to exchange the auth code; persists `connectedAccountId` in metadata; `syncTransactions` pulls succeeded charges as INCOME with cursor pagination via `ending_before`. `revokeAccess` calls `stripe.oauth.deauthorize` and tolerates 4xx (so a busted upstream never blocks disconnection).
- `lib/integrations/paypal.ts` — PayPal "Log In with PayPal" driver. Uses Basic-auth client credentials at the OAuth2 token endpoint; supports sandbox/live via `PAYPAL_ENV`. Sync stub logs and returns empty for v1 (Reporting API call requires sandbox credentials + a test merchant; tracked as a follow-up). Revoke is a documented no-op (PayPal has no programmatic OAuth revocation).
- `lib/integrations/plaid.ts` — Plaid driver: Link tokens, `/item/public_token/exchange`, `/transactions/sync` (cursor-based; idempotent). Plaid amount sign convention inverted to match our INCOME/EXPENSE convention (positive = outflow = EXPENSE). `connectStartUrl` returns null because Plaid Link is in-page; `createPlaidLinkToken(userId, state)` is exported for the API route.
- New typed Inngest event payloads stay the same; we reuse `integration/connected` (one-shot backfill) and `cron/sync-transactions.tick` (hourly fan-out).
- `inngest/functions/syncIntegration.ts` — provider-agnostic sync. `syncIntegrationOnConnect` listens for `integration/connected` and runs the driver's `syncTransactions`, upserts every `NormalisedTransaction` by `(source, externalId)` (idempotent), updates the integration's `metadata.cursor` + `lastSyncedAt`, and fan-outs `transaction/created` events for every newly-inserted EXPENSE without a category so the AI categoriser takes over. Concurrency keyed on integrationId. `syncIntegrationsHourly` listens for the cron tick and dispatches an `integration/connected` event per active row so each integration uses its own concurrency cap.
- API routes:
  - `GET /api/integrations` — list user's integrations. Encrypted token columns are NEVER returned.
  - `POST /api/integrations/[source]/connect` — start the connect flow. For STRIPE/PAYPAL returns `{ mode: 'redirect', url }`; for PLAID returns `{ mode: 'plaid-link', state, linkToken, expiration }`.
  - `GET /api/integrations/[source]/callback` — OAuth callback for redirect-style providers. Verifies state, runs driver's handleCallback, encrypts tokens, upserts an Integration row by `(userId, source)`, fires `integration/connected`. Always 302s back to /settings/integrations with `?connected=<source>` or `?error=<code>`.
  - `POST /api/integrations/[source]/exchange` — Plaid public-token exchange. 404s for non-Plaid sources.
  - `DELETE /api/integrations/[source]` — disconnect: best-effort revoke at provider, then delete row. Always 204 even on revoke failure (user is never locked in).
  - `POST /api/integrations/[source]` — manual sync trigger (202).
- `IntegrationsList` server component renders one card per registered driver via `describeDrivers()` so adding a new driver only requires a registry entry. `IntegrationCard` (server) shows display name + tagline + Connected/Not-connected badge + relative last-sync timestamp. `ConnectButton` (client) handles the redirect-vs-plaid-link branching; Plaid Link is dynamically imported via `react-plaid-link` so the bundle stays small. `IntegrationActions` (client) gives Sync now + Disconnect with confirm prompt.
- `app/(dashboard)/settings/integrations/page.tsx` — gated behind PRO. Reads ?connected/?error query params for transient banners. Cards rendered in a 1/2/3-col responsive grid.
- `app/(dashboard)/settings/page.tsx` — added Integrations card linking to /settings/integrations.
- Tests:
  - `tests/unit/integrations/state.test.ts` — round-trip sign+verify, unique nonce per call, signature tamper rejection, payload tamper rejection, source-mismatch rejection, expiry rejection (fake-timer-pinned), malformed-token rejection, missing-key error.
  - `tests/unit/integrations/registry.test.ts` — driver lookup for STRIPE/PAYPAL/PLAID, null for unsupported sources, AVAILABLE_SOURCES list shape, descriptor inPageConnect flag is true only for Plaid.
- `docs/openapi.yaml` — six new endpoint groups: list, connect, callback, exchange, disconnect, sync.
- `docs/RUNBOOK.md` — per-provider setup walkthrough (Stripe Connect platform OAuth, PayPal sandbox app + Reporting scope, Plaid dashboard + react-plaid-link install) plus an end-to-end smoke-test recipe.
- **Routing note**: removed an early `[id]/route.ts` and a static `PLAID/` folder once they were found to conflict with `[source]` — Next.js disallows two different dynamic-segment names at the same level, and a static `PLAID/` would have shadowed the `[source]` connect/callback routes for that one source. Final path layout is uniformly `[source]/...`.

### Added (2026-04-29 — Financial OS session)

- Build Order step 9: Financial OS module (Pro+ feature). Unified P&L, AI-categorised expenses, projected quarterly tax set-aside for US/CA/UK.
- `lib/finances/categories.ts` — canonical 18-slug expense vocabulary (`software`, `subscriptions`, `hardware`, `office`, `travel`, `meals`, `contractors`, `professional-services`, `advertising`, `banking-fees`, `taxes`, `insurance`, `utilities`, `rent`, `shipping`, `cogs`, `education`, `other`). Display labels + default-deductible map + `isExpenseCategory` type guard. Hard-coded list pins the AI categoriser's `z.enum(...)` and lets the UI render consistent labels/colours.
- `lib/finances/aggregate.ts` — pure helpers: `summarise(txs)` returns one `PLBucket` per currency (income/expense/net as decimal strings, big-int math under the hood — no float drift). `expenseByCategory(txs)` returns descending-sorted `CategoryBucket[]` with category share. `projectAnnualNet(ytdNet, now)` annualises YTD net linearly, floored at one day so Jan-1 inputs don't divide by zero.
- `lib/finances/categorize.ts` — Claude tool_use AI categoriser. Forces the `record_expense_category` tool with hand-maintained JSON Schema (rich field descriptions guide the model). Z-validated output with 3 retries that re-prompt the model with prior validation issues. Throws `CategorizeError` after exhaustion. `categorizeWithDefaults` aligns `taxDeductible` with the per-category default when AI confidence < 0.5.
- `lib/finances/tax/types.ts` — shared types: `TaxEstimateInput`, `TaxEstimateResult`, `BracketStep`. The `applyBrackets(income, brackets)` helper is the only piece of bracket math used by all three jurisdictions.
- `lib/finances/tax/us.ts` — TY 2024 single-filer estimator. SE tax (15.3% × 0.9235 net SE earnings, SS capped at $168,600 wage base, Medicare uncapped) + federal income tax (progressive brackets after $14,600 standard deduction and ½ SE-tax above-the-line deduction). State tax intentionally NOT modelled — surfaced as a banner.
- `lib/finances/tax/ca.ts` — TY 2024 Canadian estimator (Ontario default). Self-employed CPP (11.9% on pensionable earnings $3,500 → $68,500 YMPE) + federal brackets (15/20.5/26/29/33%) after $15,705 BPA + Ontario brackets (5.05/9.15/11.16/12.16/13.16% incl. surtax effective rates) after $12,399 BPA. ½ CPP deductible against income. EI omitted.
- `lib/finances/tax/uk.ts` — TY 2024-25 sole-trader estimator (rUK; Scotland omitted). Class 4 NICs (6% £12,570→£50,270, then 2% above). Income tax bands (20/40/45%) after a personal allowance that tapers £1-per-£2 above £100k. Class 2 NICs omitted (abolished 2024-25).
- `lib/finances/tax/index.ts` — `estimateTaxFor(jurisdiction, input)` dispatcher with TypeScript exhaustiveness check, plus `TAX_DEFAULT_CURRENCY` map.
- New typed Inngest event `transaction/created` carrying `{ userId, transactionId }`. `inngest/functions/categorizeTransaction.ts` listens for it: loads the row, short-circuits when `category !== null` or `type !== EXPENSE` (idempotent), runs `categorizeExpense`, persists the result + AI taxDeductible recommendation only when the user hasn't explicitly flipped it. Concurrency keyed on transactionId; retries=3.
- API routes:
  - `POST /api/finances/transactions` — create. Plan-gated (Pro+). Synthetic externalId `manual:<uuid>` to satisfy the `(source, externalId)` unique constraint. Fires `transaction/created` for EXPENSE rows without a category.
  - `GET /api/finances/transactions` — paginated list. Cursor pagination via `?cursor=<uuid>` (limit 1–200). Filters: `type`, `category`, `from`, `to`.
  - `PATCH /api/finances/transactions/:id` — update `category` / `taxDeductible` / `description`. Ownership-checked.
  - `DELETE /api/finances/transactions/:id` — hard delete. Ownership-checked. 204 on success.
  - `GET /api/finances/summary` — P&L summary across currencies + per-currency expense category breakdown. Default window: month-to-date UTC.
  - `GET /api/finances/tax-estimate` — YTD income + deductible expenses → `projectAnnualNet` → `estimateTaxFor`. Returns YTD figures, projection, and the full estimate (line items, notes, effective rate).
- Components:
  - `SummaryCards.tsx` — one income/expense/net row per currency bucket, accent-coloured net (green positive / red negative).
  - `CategoryBreakdown.tsx` — labelled list with horizontal share bars per category.
  - `TaxEstimateCard.tsx` — quarterly headline number + breakdown line items + REQUIRED disclaimer banner.
  - `TransactionTable.tsx` — compact server-rendered table; per-row delete via `TransactionRowActions` client island.
  - `TransactionRowActions.tsx` (client) — confirm-then-DELETE with router refresh.
  - `AddTransactionForm.tsx` (client) — typed manual entry. Type/date/amount/currency/description/category dropdown/deductible checkbox. "Auto-categorise" option leaves category blank → AI runs async.
- Pages:
  - `/finances` — dashboard. Shows MTD summary cards, where-the-money-went category breakdown, quarterly tax set-aside card, last-10-transactions table. PlanGate to PRO; FREE/STARTER see upgrade card.
  - `/finances/transactions` — full list with All/Income/Expenses filter pills.
  - `/finances/transactions/new` — manual entry page wrapping AddTransactionForm.
- Tests:
  - `tests/unit/finances/aggregate.test.ts` — 0.1 + 0.2 + 0.3 = "0.60" (no float drift), multi-currency bucketing, empty/negative-net handling, descending share sort, INCOME ignored in expense breakdown, mid-April annualisation ~3.4×.
  - `tests/unit/finances/tax/us.test.ts` — SS wage-base cap, $50k → ~$7.06k SE tax, $80k net → $3.5k–$5.5k quarterly, quarterly = annual / 4, state-tax disclaimer present.
  - `tests/unit/finances/tax/ca.test.ts` — CPP basic exemption + YMPE cap, all 3 line items present, quarterly = annual / 4.
  - `tests/unit/finances/tax/uk.test.ts` — Class 4 NIC band math, allowance taper to 0 at £125,140, £40k profit → £7,131.80 (income tax £5,486 + Class 4 £1,645.80).
  - `tests/unit/finances/categorize.test.ts` — happy path, retry-on-invalid-payload (verifies prior validation issues are passed back to the model), MAX_ATTEMPTS exhaustion → CategorizeError, empty description short-circuits without an AI call.
- `docs/openapi.yaml` — 4 new endpoint groups (transactions list+create, transaction patch+delete, summary, tax-estimate) + new `Transaction` schema reference.

### Added (2026-04-29 — Stripe subscriptions + plan gates session)

- Build Order step 8: full subscription billing surface and plan-limit enforcement.
- **Schema**: new migration `20260429000000_user_subscription_fields` adds four nullable columns to `users`: `stripeSubscriptionId` (UNIQUE), `stripePriceId`, `subscriptionStatus`, `currentPeriodEnd`. All four are mutated EXCLUSIVELY by the Stripe webhook handler.
- `lib/billing/limits.ts` — plan-limit accounting helpers. `countActiveProjects(userId)`, `countScopeChecksThisMonth(userId)` (UTC month boundary), and the two consumer-friendly verdicts `checkActiveProjectLimit({ id, planTier })` and `checkScopeCheckLimit({ id, planTier })`. Each verdict returns `{ allowed, usage, limit }` on success, or `{ allowed: false, reason: 'PLAN_LIMIT_EXCEEDED', capability, suggestedTier }` on failure. `Infinity` short-circuits the DB count for PRO/BUSINESS users.
- `lib/stripe/webhookEvents.ts` — typed handlers for the five Stripe events ScopeGuard subscribes to (`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`). `subscriptionStateFromStripe(sub)` is the pure function that derives `{ planTier, subscriptionStatus, currentPeriodEnd, stripePriceId, stripeSubscriptionId }` from a Stripe.Subscription — `active`/`trialing` preserve the paid tier; everything else (canceled, past_due, unpaid, incomplete_expired, unknown priceId) drops the user back to FREE. Handlers are idempotent ("set state to X" derived from the payload), so Stripe retries are safe.
- `components/billing/PlanGate.tsx` — server-component wrapper that gates a feature behind a minimum tier (FREE < STARTER < PRO < BUSINESS via `tierSatisfies`). Lower-tier users see an upgrade card with a "View plans →" button; satisfied users see `children`. Accepts an optional `fallback` for non-card alternative renderings.
- `components/billing/PricingTable.tsx` — three-card grid for STARTER/PRO/BUSINESS. The PRO card carries a "Popular" pill; the user's current tier carries a "Current" pill and a disabled CTA. Each card lists the four canonical features with check / strikethrough markers driven by `PlanLimits`.
- `components/billing/CheckoutButton.tsx` (client) — POSTs to `/api/billing/checkout` with the target tier, redirects to the returned Stripe Checkout URL, surfaces inline error messages for 4xx/5xx responses.
- `components/billing/SubscriptionCard.tsx` — current-plan card with status badge (Active / Trial / Past due / Cancelled / etc.), period-end copy ("Renews …" or "Access ends …" depending on cancellation state), and the Manage Subscription button.
- `components/billing/ManageSubscriptionButton.tsx` (client) — POSTs to `/api/billing/portal` and forwards to the Stripe Customer Portal URL. Handles the no-customer-yet 409 with a friendlier message.
- `app/api/billing/checkout` — `POST /api/billing/checkout`. Authenticated. Body: `{ tier: 'STARTER' | 'PRO' | 'BUSINESS' }`. Lazily provisions a Stripe customer (persists `stripeCustomerId` on first use). Creates a `mode: 'subscription'` Checkout Session with `allow_promotion_codes: true` and `subscription_data.metadata` including `userId` + `tier`. Returns `{ url }`. 503 when the price ID env var is missing; 502 on Stripe API failure.
- `app/api/billing/portal` — `POST /api/billing/portal`. Authenticated. Returns `{ url }` for a one-shot Customer Portal session. 409 when the user has no `stripeCustomerId`. Return URL is `/settings/billing`.
- `app/api/webhooks/stripe` — `POST /api/webhooks/stripe`. Reads the raw body (mandatory for signature verification — calling `request.json()` first would normalise whitespace and break the HMAC). Verifies `Stripe-Signature` against `STRIPE_WEBHOOK_SECRET`. Returns 401 on signature failure (Stripe stops retrying). Dispatches to one of five typed handlers; unknown event types return 200 with `{ accepted: true, ignored: true }` so Stripe stops retrying but the dashboard still surfaces the dead-letter for tuning. Handler exceptions return 500 → Stripe retries with backoff.
- `app/(dashboard)/settings/billing/page.tsx` — billing landing. Re-reads the canonical user row from Prisma so the latest webhook-applied state is shown. Banner for `?checkout=success` and `?checkout=cancelled` query params returned from the Checkout redirect. SubscriptionCard + PricingTable.
- `app/(dashboard)/settings/page.tsx` — added a "Billing & plans" card linking to `/settings/billing`.
- **Plan-limit enforcement points**:
  - `app/(dashboard)/projects/actions.ts` — `createProjectAction` now calls `checkActiveProjectLimit(user)` before `prisma.project.create` and returns an actionable `error` string when the user is at their cap.
  - `app/api/scope/check/route.ts` — calls `checkScopeCheckLimit(user)` after IP rate-limiting but before the AI call. Over-limit users receive HTTP **402 Payment Required** with `{ code: 'PLAN_LIMIT_EXCEEDED', upgradeTo, usage, limit }`. The Postmark inbound pipeline (`processInboundEmail`) intentionally does NOT enforce this — paying customers should never silently drop a real client email; over-limit checks are billed-but-allowed.
- `tests/unit/billing/limits.test.ts` — Prisma mocked at module scope. Asserts: under-cap allows; FREE→STARTER, STARTER→PRO, PRO/BUSINESS short-circuit (no DB call); UTC month boundary on the count query (`gte` argument is the first of the current month at 00:00 UTC, fake-timer-pinned).
- `tests/unit/stripe/webhookEvents.test.ts` — pure function `subscriptionStateFromStripe` matrix: `active` + `trialing` keep the paid tier; `canceled` / `past_due` / `unpaid` / `incomplete_expired` / unknown priceId all downgrade to FREE; UNIX-seconds → JS Date conversion verified.
- `docs/openapi.yaml` — entries for `POST /api/billing/checkout`, `POST /api/billing/portal`, `POST /api/webhooks/stripe`. Added `402 PLAN_LIMIT_EXCEEDED` to the `/api/scope/check` response set.
- `docs/RUNBOOK.md` — Stripe setup walkthrough (products + prices, Customer Portal config, webhook endpoint + signing secret, restricted-key permissions, local `stripe listen` workflow, smoke-test checklist).

### Added (2026-04-29 — scope-check UI session)

- Build Order step 7: full scope-check UI surface.
- `components/ui/badge.tsx` — three new variants: `verdict-in-scope`, `verdict-out-of-scope`, `verdict-ambiguous`. All use the CSS variable palette already declared in `globals.css`.
- `components/scope/VerdictCard.tsx` — server component rendering a single ScopeCheck as a full detail card. Sections: verdict badge + confidence label + date header; email subject + from address; cited clause block with optional clause reference; estimated hours (OUT_OF_SCOPE only); drafted reply and change-order draft (via ChangeOrderDraft client islands); user-action footer (UserActionForm when action not yet recorded, read-only label when it has been). Left border is coloured by verdict using an inline CSS variable. Accepts an optional `showProject` prop for the inbox view.
- `components/scope/ChangeOrderDraft.tsx` (client) — labelled copyable text block used for both drafted reply and change-order text. Copy button shows a 2-second "Copied!" confirmation.
- `components/scope/UserActionForm.tsx` (client) — three action buttons (Sent change order / Accepted anyway / Ignored). Uses `useOptimistic` to hide buttons immediately on click. Calls `recordUserActionAction` server action.
- `components/scope/ScopeLogTable.tsx` — server component rendering a compact, scrollable table of scope checks for a single project (columns: date, verdict badge, confidence %, subject, from, action taken). Empty state includes a link to run a manual check. "View all" and "Run manual check" footer links.
- `components/scope/InboxRealtimeFeed.tsx` (client) — zero-height island that subscribes to `scope_checks` INSERT events via Supabase Realtime and calls `router.refresh()` so the inbox page re-renders without a hard navigation. No payload data is read from the event; all data comes from the server-side Prisma query.
- `components/scope/ScopeCheckForm.tsx` (client) — manual scope-check form (email body textarea + optional subject/from fields). POSTs to `POST /api/scope/check`, shows a loading state during the AI call, and renders an inline result card (verdict badge, cited clause, ChangeOrderDraft) with a "View in Inbox" link. Handles network errors and API error envelopes.
- `app/(dashboard)/inbox/actions.ts` — `recordUserActionAction` server action. Zod-validates `scopeCheckId` (UUID) + `userAction` (nativeEnum); confirms ownership via project join; first-write-wins (subsequent calls no-op); revalidates `/inbox` and `/projects` layout on success.
- `app/(dashboard)/inbox/page.tsx` — real inbox feed. Queries up to 50 scope checks across all user projects (newest first), renders them as VerdictCards with `showProject`, mounts `InboxRealtimeFeed`, and shows a guided empty state with step-by-step instructions.
- `app/(dashboard)/projects/[id]/page.tsx` — replaced the "scope-log table lands in session 7" placeholder with a real `ScopeLogTable` (20 most recent checks). Added "Run manual check" button in the page header next to "Manage contracts".
- `app/(dashboard)/projects/[id]/scope-check/page.tsx` — manual scope-check page. Server component checks auth + project ownership and surfaces a warning when no parsed contract exists. Renders `ScopeCheckForm` client island + a "How this works" help card.
- `app/api/scope/check` — `POST /api/scope/check`. Authenticated + rate-limited (scopeCheckLimiter 50/h). Accepts `{ projectId, emailBody, emailSubject?, emailFromAddress? }`. Loads latest parsed contract (falls back to skeletonParsedContract). Calls `checkScope` inline. Persists ScopeCheck row. Emits `scope/check.completed` to Inngest. Returns 201 with the check. See `docs/openapi.yaml` for the full schema.
- `docs/openapi.yaml` — entry for `POST /api/scope/check` added; removed stale TODO comments for the session-6 webhook entries.

### Realtime setup (one-time)

The inbox feed uses Supabase Realtime to push new verdicts without a page reload. Enable it once per environment:

```sql
-- Run in the Supabase SQL editor.
alter publication supabase_realtime add table scope_checks;
```

### Added (2026-04-28 — inbound email pipeline session)

- Build Order step 6: end-to-end scope-check pipeline triggered by inbound email.
- `lib/email/inbound.ts` — `verifyPostmarkSignature` constant-time check against `POSTMARK_WEBHOOK_SECRET`, `InboundPayloadSchema` Zod schema for the subset of Postmark fields we use, and `toScopeEmailEvent` to lift those into the typed `scope/email.received` shape. `StrippedTextReply` is preferred over `TextBody` so quoted reply history doesn't reach Claude. Both `From:` and `To:` accept either `"Name <email>"` headers or bare addresses.
- `lib/email/outbound.ts` — lazy Postmark `ServerClient` singleton + `sendEmail({ to, subject, textBody, htmlBody?, messageStream? })`. Local-dev convenience: when `POSTMARK_SERVER_TOKEN` is unset and `NODE_ENV !== production` the helper logs a `email.dryrun` line and returns null instead of failing.
- New Inngest event `contract/parsed` in the typed registry. `parseUploadedContract` now emits it from the post-save step so `processInboundEmail` can `step.waitForEvent` on the matching `contractId`.
- `inngest/functions/processInboundEmail.ts` — the verdict pipeline. Steps: lookup user by `inboundEmailAlias`; match project by sender email (exact `clientEmail`, falling back to the user's most recent active project); load latest contract; wait up to 15 min for `contract/parsed` when `parsedAt` is null; run `checkScope`; persist `ScopeCheck`; emit `scope/check.completed`. Idempotency keyed on `event.data.postmarkMessageId` so Postmark resends never double-process. NonRetriableError on unknown alias and empty body.
- `inngest/functions/notifyUserOfVerdict.ts` — fires on `scope/check.completed`, sends a short transactional email with the verdict label, confidence, cited clause, estimated hours (when out of scope), and deep links to inbox + project. Idempotency keyed on `event.data.scopeCheckId` so a duplicate event doesn't double-send.
- `app/api/webhooks/postmark/route.ts` — receives the inbound payload. Verifies the `X-Postmark-Signature` header (a shared secret echoed back by Postmark — Postmark inbound is not natively signed; see ADR-002). Parses + validates the body. Publishes `scope/email.received` with the Inngest event id set to the Postmark `MessageID` so retries reuse the same id and Inngest's built-in idempotency rejects duplicates. Always returns 200 within milliseconds — heavy work is async.
- `tests/fixtures/postmark.ts` — three Postmark inbound payloads (full canonical, header-form addresses, malformed missing MessageID).
- `tests/unit/email/inbound.test.ts` — signature verification (timing-safe, length-mismatch, env-unset, null-header), payload schema accept/strip/reject, `toScopeEmailEvent` body-fallback + header-form parsing + lowercasing + Postmark-MessageID preservation.
- `tests/unit/email/outbound.test.ts` — dev dry-run (no token + non-production), missing FROM error, Postmark forward with full args, htmlBody only when supplied, custom MessageStream.

### Added (2026-04-28 — contract upload session)

- Build Order step 5: contract upload + extraction + async parse pipeline.
- `lib/contracts/extract.ts` — text extraction from PDF/DOCX/text/markdown buffers via dynamic imports of `pdf-parse` and `mammoth`. Hard 10 MB ceiling and 120k-char post-extraction cap with truncation marker. Three typed errors (`UnsupportedFileTypeError`, `ContractTooLargeError`, `ExtractionFailedError`).
- `lib/contracts/storage.ts` — Supabase Storage helpers for the `contracts` bucket. Object keys follow `<userId>/<projectId>/<uuid>.<ext>`. Helpers: `buildContractStorageKey`, `uploadContractBuffer`, `downloadContractBuffer`, `getSignedContractUrl` (15-min default TTL), `deleteContractObject`.
- `tests/unit/contracts/extract.test.ts` — MIME dispatch, whitespace normalisation, oversize rejection, parser-failure wrapping, truncation behaviour. `pdf-parse` and `mammoth` are vi-mocked so the suite stays hermetic.
- `inngest/functions/parseUploadedContract.ts` — async pipeline triggered by `contract/uploaded`: load contract row, download from Storage, extract text, persist `rawText`, run `parseContract`, save deliverables/exclusions/paymentTerms/overallRiskScore + `parsedAt`. Idempotent (short-circuits when already parsed). 3 retries with single-concurrency-per-contract.
- `inngest/functions/index.ts` + `app/api/webhooks/inngest/route.ts` — Inngest serve endpoint registering the function list. Adding a new function only requires exporting it from the barrel.
- API routes:
  - `POST /api/contracts` — multipart upload. Authenticated, project-scoped, MIME + size validated, rate-limited via `contractParseLimiter`. Streams to Storage, creates the contract row with `rawText: null`, fires `contract/uploaded`, returns 201.
  - `GET /api/contracts/:id` — status polling shape (id, fileName, parsedAt, deliverables/exclusions/paymentTerms/overallRiskScore).
  - `DELETE /api/contracts/:id` — removes the row and best-effort deletes the Storage object (failures logged for the orphan-sweep).
  - `POST /api/contracts/:id/parse` — re-trigger parsing (clears `parsedAt` first so the Inngest function doesn't short-circuit). Rate-limited.
- Project surface:
  - `app/(dashboard)/projects/actions.ts` — `createProjectAction` with Zod-validated FormData and inline field errors.
  - `components/projects/NewProjectForm.tsx` — accessible client island with field-level error rendering.
  - `app/(dashboard)/projects/new/page.tsx` — new-project page.
  - Updated `app/(dashboard)/projects/page.tsx` — real card grid with contract/scope-check counts and a "New project" CTA.
  - `app/(dashboard)/projects/[id]/page.tsx` — project detail with parse-status badge, link to contracts, scope-log placeholder.
  - `app/(dashboard)/projects/[id]/contracts/page.tsx` — upload area + parsed-clause viewer.
- UI components:
  - `components/ui/badge.tsx` — pill badge with default/secondary/destructive/outline/success variants (success uses the verdict-in-scope token).
  - `components/shared/UploadDropzone.tsx` — drag-and-drop with keyboard fallback, client-side size guard, `router.refresh()` after a successful POST so the page re-reads the contract row.
  - `components/scope/ContractClauseViewer.tsx` — renders deliverables (with ambiguous flags + reasons), exclusions, and payment terms. Pure presentational; receives JSON straight from the Prisma row.

### Added (2026-04-28 — core AI session)

- `lib/ai/` layer (Build Order step 4):
  - `lib/ai/types.ts` — `ParsedContract`, `ScopeCheckResult`, `ProjectContext`. The first two are inferred from Zod schemas so type and validator never drift.
  - `lib/ai/schemas.ts` — single source of truth for the AI outputs. Each tool has a Zod schema (runtime validation) and a hand-maintained JSON Schema (Anthropic `input_schema` with `description` fields the model uses for quality). Two tools: `record_parsed_contract` and `record_scope_verdict`.
  - `lib/ai/errors.ts` — `AIError`, `ContractParseError`, `ScopeCheckError`. Each subclass carries an `attempts` field so callers can distinguish "valid but rejected by retry budget" from a transport failure.
  - `lib/ai/client.ts` — lazy Anthropic SDK singleton + `callTool()` helper that forces `tool_choice` to a specific tool. Returns `{ input, stopReason, usage }`. Tests mock this module rather than the SDK so the mock surface stays small.
  - `lib/ai/parseContract.ts` — extracts deliverables, exclusions, payment terms, revision policy, and a 1–10 risk score from a contract text. Tool_use forced. Retries up to 3 times on Zod validation failure with a re-prompt that includes the validation issues so the model can self-correct. Logs `ai.parseContract.completed` with token usage.
  - `lib/ai/checkScope.ts` — IN_SCOPE / OUT_OF_SCOPE / AMBIGUOUS verdict with confidence, cited clause, polite-decline draft, and change-order draft. Contract context block carries `cache_control: ephemeral` so back-to-back checks against the same contract hit Anthropic's prompt cache. Same retry policy as parseContract. Logs `ai.checkScope.completed` including `cache_read_input_tokens`.
  - `lib/ai/index.ts` — barrel export.
- Test fixtures:
  - `tests/fixtures/contracts.ts` — five contracts (simple / complex / vague / exclusion-heavy / no-exclusions).
  - `tests/fixtures/emails.ts` — ten email scenarios (2 clear in-scope, 2 clear out-of-scope, 3 ambiguous, 3 edge cases including the empty-thanks email and the multi-request email mixing in/out of scope items).
- New unit tests:
  - `tests/unit/ai/parseContract.test.ts` — happy path across all 5 fixtures, input-validation rejection (empty / oversize), retry-on-invalid-payload, MAX_ATTEMPTS exhaustion → ContractParseError, transport-error wrapping.
  - `tests/unit/ai/checkScope.test.ts` — happy path across all 10 emails, prompt-construction asserting the cache_control marker on the contract block (and its absence on the email block), deterministic context rendering, retry behaviour, MAX_ATTEMPTS exhaustion → ScopeCheckError.

### Added (2026-04-28 — auth session)

- Auth surface (Build Order step 3):
  - `app/(auth)/layout.tsx`, `app/(auth)/login/page.tsx`, `app/(auth)/signup/page.tsx`.
  - `components/auth/LoginForm.tsx` and `SignupForm.tsx` — client islands using `useFormState` + `useFormStatus` for accessible pending/error UX. Signup form captures the browser's IANA timezone and renders a confirmation panel rather than navigating.
  - `app/(auth)/actions.ts` — server actions `loginAction`, `signupAction`, `googleSignInAction`. All Zod-validated, IP-rate-limited (10/min via the `authLimiter`), and returning a structured `AuthActionResult` so the form can re-render errors inline.
  - `app/api/auth/callback/route.ts` — OAuth + email-confirmation callback. Exchanges the code for a session, calls `ensureUserProfile`, redirects to a sanitised `next` path (open-redirect guard). Surfaces failure modes to `/login?error=…`.
  - `app/api/auth/signout/route.ts` — POST-only signout (CSRF-safe).
- `lib/auth/inboundAlias.ts` — generates the `<slug>-<random>@<domain>` Postmark forwarding alias from the user's email, with a fallback when the local part has no usable characters. Tests: 1k-sample collision check + slug edge cases.
- `lib/auth/getCurrentUser.ts` — `getCurrentUser()` for nullable lookups and `requireCurrentUser()` for protected pages (redirects to /login).
- `lib/auth/ensureUserProfile.ts` — idempotent create-or-fetch for the public `users` row mirroring the Supabase auth user. Race-safe (catches the unique-constraint conflict and re-fetches).
- Authenticated app shell:
  - `app/(dashboard)/layout.tsx` — header with sign-out form + nav. Calls `ensureUserProfile` on every render as the safety net for users who arrived through OAuth without hitting the callback's profile step.
  - `app/(dashboard)/projects/page.tsx` — surfaces the user's inbound alias and an empty state. Project CRUD lands later.
  - Placeholders for `/inbox`, `/finances`, `/settings` so the nav doesn't 404.
- `middleware.ts` — now also redirects authenticated users away from `/login` and `/signup` (no more "logged in but stuck on the login form").
- shadcn/ui primitives: `Input`, `Label`, `Card` (+ Header/Title/Description/Content/Footer), `Alert` (with role=alert and a destructive variant).
- New unit test: `tests/unit/auth/inboundAlias.test.ts`.

### Added (2026-04-27 — scaffold session)

- Repository skeleton: Next.js 14 App Router with TypeScript strict mode, Tailwind, shadcn/ui base config.
- Lint + format toolchain: ESLint (typescript-eslint, next, prettier), Prettier, lint-staged config.
- Test toolchain: Vitest with v8 coverage thresholds (80% lines), Playwright config.
- Prisma schema covering `User`, `Project`, `Contract`, `ScopeCheck`, `Transaction`, `Integration`, plus all supporting enums.
- Initial migration `20260427000000_init` with table comments wired through.
- RLS migration `20260427000100_enable_rls` enabling RLS on every user-owned table with explicit per-action policies.
- Idempotent `prisma/seed.ts` for local development.
- Server utilities: `lib/utils/encryption.ts` (AES-256-GCM token wrapper), `lib/utils/logger.ts` (structured JSON logger with secret redaction), `lib/utils/rateLimit.ts` (Upstash sliding-window limiters), `lib/utils/currency.ts`, `lib/utils/dates.ts`, `lib/utils/validation.ts`, `lib/utils/cn.ts`.
- Supabase clients (`lib/supabase/client.ts` + `server.ts` + admin client).
- Stripe client + plan catalogue (`lib/stripe/client.ts`, `lib/stripe/plans.ts`).
- Inngest client with typed event registry (`inngest/client.ts`).
- Prisma singleton (`lib/prisma.ts`).
- Minimal app shell: root layout, landing page, `/not-found`, error boundary, `globals.css` with CSS variables for light + dark mode.
- shadcn/ui Button component as the seed UI primitive.
- Strict CSP, HSTS, and frame-deny headers wired in `next.config.ts`.
- Documentation: `README.md`, `docs/README.md`, `docs/RUNBOOK.md`, this CHANGELOG, `docs/schema.md`, `docs/openapi.yaml` skeleton, ADRs 001-003.
- CI workflow (`.github/workflows/ci.yml`) running typecheck + lint + unit tests on every PR.
- Initial unit tests for encryption (round-trip + tamper) and currency arithmetic.

### Notes

The repo is currently a scaffold. Feature work (auth pages, AI functions, inbound email pipeline, Stripe checkout, Financial OS) lands in subsequent sessions per the Build Order in the spec / `README.md`.
