# ScopeGuard documentation index

Everything that doesn't live in code lives here. Source-of-truth for new engineers, on-call responders, and anyone trying to understand "why".

---

## Project-level docs

| File | When to read it |
| --- | --- |
| [`../README.md`](../README.md) | First thing — quick-start, tech stack, scripts, Definition of Done |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Module map, request lifecycle diagrams, key invariants. Read before opening a PR that touches more than one module. |
| [`RUNBOOK.md`](RUNBOOK.md) | Step-by-step operations: setup, deploy, rollback, secret rotation, per-provider integration setup, production hardening checklist |
| [`CHANGELOG.md`](CHANGELOG.md) | Per-session log of what shipped — read to catch up after time away |
| [`schema.md`](schema.md) | Database schema reference: every table, every column. Update in the same PR as a Prisma migration. |
| [`openapi.yaml`](openapi.yaml) | OpenAPI 3.1 contract for every public API route. Source for client SDK generation in the future. |
| [`adr/`](adr/) | Architecture Decision Records — one per major decision with full context |

---

## Architecture Decision Records

Read these in order to understand "why this stack" and "why these constraints".

| ADR | Topic |
| --- | --- |
| [`adr/001-tech-stack.md`](adr/001-tech-stack.md) | Why Next.js + Supabase + Inngest + Anthropic |
| [`adr/002-email-gateway.md`](adr/002-email-gateway.md) | Why Postmark + custom-header signature verification |
| [`adr/003-ai-model-choice.md`](adr/003-ai-model-choice.md) | Why Claude Sonnet 4.6 with forced `tool_use` |
| [`adr/004-observability.md`](adr/004-observability.md) | Why Sentry + PostHog + structured logger (three tiers) |

When proposing a major change, write a new ADR (`adr/00N-<slug>.md`) BEFORE the implementation PR — review the ADR first, the code second.

---

## Source-tree commentary

When the spec asks for a file-by-file overview, this is the map.

### `app/`

Next.js App Router pages, layouts, and route handlers.

```
app/
├── layout.tsx                       Root HTML shell + PostHog provider
├── page.tsx                         Marketing landing page (public)
├── error.tsx                        Per-route error boundary → Sentry
├── global-error.tsx                 Last-resort root-layout boundary → Sentry
├── not-found.tsx                    404
├── globals.css                      Tailwind layers + CSS variables (incl. verdict palette)
│
├── (auth)/                          Public auth surface — no shell chrome
│   ├── login/page.tsx               Email + Google OAuth
│   ├── signup/page.tsx              Email + Google OAuth, captures browser timezone
│   └── actions.ts                   Server actions for login/signup/google
│
├── (dashboard)/                     Authenticated app — shared layout + nav
│   ├── layout.tsx                   Header + nav + sign-out form
│   ├── projects/                    Project CRUD + scope-check sub-pages
│   │   ├── new/page.tsx
│   │   ├── [id]/page.tsx            Detail + ScopeLogTable
│   │   ├── [id]/contracts/page.tsx  Upload + parsed-clause viewer
│   │   └── [id]/scope-check/page.tsx Manual scope check form
│   ├── inbox/page.tsx               Real-time verdict feed
│   ├── inbox/actions.ts             recordUserActionAction
│   ├── finances/                    Financial OS (PRO+)
│   ├── settings/                    Account + Billing + Integrations sub-pages
│   └── ...
│
└── api/                             Route handlers
    ├── auth/                        /callback, /signout
    ├── billing/                     /checkout, /portal
    ├── contracts/                   POST/GET/DELETE/parse
    ├── finances/                    transactions CRUD + summary + tax-estimate
    ├── integrations/[source]/       connect, callback, exchange (Plaid), DELETE/POST
    ├── scope/check/                 Manual AI scope check
    ├── webhooks/                    /stripe, /postmark, /inngest
    └── health/                      Liveness + ?deep=1 readiness
```

### `components/`

Server + client React components. Server-by-default; `'use client'` only when needed for interactivity.

```
components/
├── auth/                LoginForm, SignupForm
├── billing/             PlanGate (server gate), PricingTable, CheckoutButton (client),
│                        SubscriptionCard, ManageSubscriptionButton (client)
├── finances/            SummaryCards, CategoryBreakdown, TaxEstimateCard,
│                        TransactionTable, AddTransactionForm (client),
│                        TransactionRowActions (client)
├── integrations/        IntegrationCard, ConnectButton (client),
│                        IntegrationActions (client)
├── observability/       PostHogProvider (client)
├── projects/            NewProjectForm (client)
├── scope/               VerdictCard, ScopeLogTable, ChangeOrderDraft (client),
│                        UserActionForm (client), InboxRealtimeFeed (client),
│                        ScopeCheckForm (client), ContractClauseViewer
├── shared/              UploadDropzone (client)
└── ui/                  shadcn/ui primitives — Button, Card, Input, Label, Alert, Badge
```

### `lib/`

Server-side domain logic and utilities. None of this code is bundled to the client (most files use `'server-only'`).

```
lib/
├── ai/                  parseContract + checkScope on Claude tool_use
│                         schemas.ts is the SINGLE source of truth (Zod + JSON Schema)
├── auth/                getCurrentUser, requireCurrentUser, ensureUserProfile,
│                        inboundAlias generator
├── billing/             limits.ts — countActiveProjects, countScopeChecksThisMonth,
│                        checkActiveProjectLimit, checkScopeCheckLimit
├── contracts/           extract.ts (PDF/DOCX → text), storage.ts (Supabase Storage)
├── email/               inbound.ts (Postmark verification + parsing),
│                        outbound.ts (Postmark ServerClient with dev dry-run)
├── finances/            categories.ts (18 expense slugs), aggregate.ts (P&L math),
│                        categorize.ts (AI categoriser), tax/{us,ca,uk,index}.ts
├── integrations/        types.ts (driver interface), registry.ts, state.ts (CSRF),
│                        stripe.ts, paypal.ts, plaid.ts
├── observability/       sentry.ts (server adapter), posthog.ts (server SDK)
├── stripe/              client.ts (platform SDK), plans.ts (catalogue),
│                        webhookEvents.ts (subscriptionStateFromStripe + handlers)
├── supabase/            client.ts (browser), server.ts (SSR + admin)
├── utils/               currency, dates, encryption (AES-256-GCM), logger (JSON + Sentry bridge),
│                        rateLimit (per-user), ipRateLimit (per-IP), validation, cn
└── prisma.ts            Prisma client singleton
```

### `inngest/`

Background jobs — typed event registry + per-event functions.

```
inngest/
├── client.ts                       Typed Events map (single source of truth)
└── functions/
    ├── index.ts                    Barrel — register a function here to serve it
    ├── parseUploadedContract.ts    contract/uploaded → extract → parseContract
    ├── processInboundEmail.ts      scope/email.received → checkScope → save
    ├── notifyUserOfVerdict.ts      scope/check.completed → email
    ├── categorizeTransaction.ts    transaction/created → AI categorise → save
    └── syncIntegration.ts          integration/connected (one-shot) +
                                    cron/sync-transactions.tick (hourly fan-out)
```

### `prisma/`

```
prisma/
├── schema.prisma                                Single source of truth
├── seed.ts                                      Local dev seed
└── migrations/
    ├── 20260427000000_init/                     Initial tables
    ├── 20260427000100_enable_rls/               RLS policies on every userId-bearing table
    └── 20260429000000_user_subscription_fields/ Stripe subscription columns on users
```

### `tests/`

```
tests/
├── setup.ts                Vitest setup
├── fixtures/               Shared fixtures: contracts, emails, postmark payloads
├── unit/                   Vitest — pure helpers + AI clients (mocked)
└── e2e/                    Playwright — see tests/e2e/README.md for the full layout
```

### Root configuration

```
next.config.ts              CSP + security headers + webpack tweaks (pdf-parse external)
tailwind.config.ts          Tokens + verdict palette
playwright.config.ts        Two-project layout: chromium-public + chromium-auth
tsconfig.json               Strict mode (noUncheckedIndexedAccess, exactOptionalPropertyTypes)
vitest.config.ts            Coverage 80% lines on lib/
vercel.json                 Per-route maxDuration tuning
instrumentation.ts          Next.js register hook → loads sentry.{server,edge}.config
sentry.{client,server,edge}.config.ts  Sentry SDK init per runtime
middleware.ts               Auth gate — protects /projects /inbox /finances /settings
```

---

## When the answer to "why?" is non-obvious

If a piece of behaviour is surprising — a non-default sample rate, a deliberately-not-cached Prisma query, a webhook that always returns 200 — there should be a comment in the file explaining the reasoning. If the reasoning spans more than a paragraph, it belongs in an ADR.
