# ScopeGuard

> AI-powered scope enforcement and financial OS for freelancers and solopreneurs.

ScopeGuard reads a freelancer's contract, watches forwarded client emails, and surfaces a verdict — **in scope**, **out of scope**, or **ambiguous** — within seconds. When a request crosses the line, ScopeGuard cites the exact contract clause and drafts both a polite decline and a change order. The Financial OS module unifies revenue, expenses, and quarterly tax estimates in one plain-English dashboard.

This repository is a **production-grade build**, not a prototype. Every file has a top-of-file documentation block, every public function has TSDoc, every API route has an OpenAPI entry, and every architectural decision is captured in `docs/adr/`.

---

## Quick start

```bash
git clone <repo-url> scopeguard && cd scopeguard
pnpm install
cp .env.example .env.local              # fill in the required vars
pnpm prisma:migrate                     # run migrations against your local DB
pnpm prisma:seed                        # optional: load demo data
pnpm dev                                # http://localhost:3000
```

Required local services:

| Service        | Why                              | How to get it locally                           |
| -------------- | -------------------------------- | ----------------------------------------------- |
| Postgres       | Application database             | `supabase start` or any Postgres ≥14            |
| Supabase Auth  | Login + storage + RLS            | Free Supabase project — see RUNBOOK             |
| Anthropic key  | Contract parsing + scope check   | console.anthropic.com                           |
| Stripe (test)  | Subscriptions + webhooks         | dashboard.stripe.com → use test mode            |
| Postmark       | Inbound email parsing            | Free dev account — `inbound.scopeguard.app`     |
| Inngest        | Background jobs                  | `pnpm inngest:dev` for the local dev server     |
| Upstash Redis  | Rate limiting                    | console.upstash.com — free tier is enough       |

Detailed setup steps live in [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

---

## Repository layout

```
app/         Next.js App Router (UI + API routes)
components/  Reusable UI — shadcn/ui base + product components
lib/         AI, integrations, utilities, server-only helpers
inngest/     Background-job event registry + functions
prisma/      Schema, migrations, seed
tests/       Vitest unit tests + Playwright E2E
docs/        README, RUNBOOK, ADRs, OpenAPI, schema docs
.github/     CI/CD workflows
```

Full file-by-file commentary is in [`docs/README.md`](docs/README.md).

---

## Tech stack

| Layer           | Choice                                              |
| --------------- | --------------------------------------------------- |
| Framework       | Next.js 14 (App Router)                             |
| Language        | TypeScript (strict + `noUncheckedIndexedAccess`)    |
| Database        | PostgreSQL via Supabase                             |
| ORM             | Prisma                                              |
| Auth            | Supabase Auth (email + Google OAuth)                |
| AI              | Anthropic Claude (`claude-sonnet-4-6`) — see ADR-003 |
| Inbound email   | Postmark                                            |
| Payments        | Stripe (subscriptions + Stripe Connect)             |
| File storage    | Supabase Storage                                    |
| Background jobs | Inngest                                             |
| Styling         | Tailwind CSS + shadcn/ui                            |
| Testing         | Vitest (unit) + Playwright (E2E)                    |
| Errors          | Sentry                                              |
| Analytics       | PostHog                                             |
| Hosting         | Vercel + Supabase                                   |
| CI              | GitHub Actions                                      |

Decisions are recorded as ADRs in [`docs/adr/`](docs/adr/). Don't substitute any of these without writing a new ADR.

---

## Scripts

```bash
pnpm dev                  # next dev
pnpm build                # next build
pnpm typecheck            # tsc --noEmit
pnpm lint                 # next lint
pnpm format               # prettier --write
pnpm test                 # vitest run
pnpm test:watch           # vitest
pnpm test:coverage        # vitest with v8 coverage
pnpm test:e2e             # playwright test
pnpm prisma:generate      # regenerate Prisma client
pnpm prisma:migrate       # create + apply migration in dev
pnpm prisma:seed          # seed demo data
pnpm inngest:dev          # local Inngest dev server
```

---

## Definition of Done

A pull request is not mergeable until:

- [ ] `pnpm typecheck` passes with zero errors.
- [ ] `pnpm test` passes with ≥80% line coverage on `lib/`.
- [ ] `pnpm test:e2e` passes (when UI changes are involved).
- [ ] `pnpm lint` reports zero warnings.
- [ ] Every new file/function has documentation per the rules in this README.
- [ ] Every new API route has an OpenAPI entry in `docs/openapi.yaml`.
- [ ] Every new env var is in `.env.example` with description and example value.
- [ ] `docs/CHANGELOG.md` is updated.
- [ ] The feature works in light AND dark mode.
- [ ] The feature is keyboard accessible.
- [ ] No `console.log` in production code (use `lib/utils/logger.ts`).
- [ ] No hardcoded secrets, URLs, or tunable strings — those belong in env or config.
- [ ] If a new DB table was added, RLS policies were added and tested.

---

## Build status

This scaffold is **session 1 of N**. The full Build Order from the spec is:

1. ~~Scaffold~~
2. ~~Database (schema + RLS migration)~~
3. ~~Auth (Supabase auth, login/signup, dashboard middleware)~~
4. ~~Core AI (`parseContract.ts`, `checkScope.ts`)~~
5. ~~Contract upload + extraction (Storage + pdf-parse + mammoth)~~
6. Inbound email pipeline (Postmark webhook + Inngest → checkScope) — _next_
5. Contract upload + extraction
6. Inbound email pipeline (Postmark + Inngest)
7. Scope-check UI
8. Stripe subscriptions + PlanGate
9. Financial OS (transactions, P&L, tax estimate)
10. Additional integrations (PayPal, Plaid)
11. E2E suite
12. Production hardening (CSP, rate-limit, Sentry, PostHog)
13. Documentation pass

See [`docs/CHANGELOG.md`](docs/CHANGELOG.md) for what has shipped.
