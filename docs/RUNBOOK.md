# Runbook

Step-by-step procedures for operating ScopeGuard. Every entry is intended to be runnable cold by a new engineer.

---

## Table of contents

1. [Local development setup](#1-local-development-setup)
2. [Deploying to production](#2-deploying-to-production)
3. [Rolling back a bad deploy](#3-rolling-back-a-bad-deploy)
4. [Running database migrations](#4-running-database-migrations)
5. [Rotating secrets](#5-rotating-secrets)
6. [Adding a new payment integration](#6-adding-a-new-payment-integration)
7. [Investigating a Postmark inbound failure](#7-investigating-a-postmark-inbound-failure)
8. [Investigating a Stripe webhook failure](#8-investigating-a-stripe-webhook-failure)
9. [Replaying a failed Inngest job](#9-replaying-a-failed-inngest-job)
10. [Onboarding a new engineer](#10-onboarding-a-new-engineer)

---

## 1. Local development setup

**Time:** ~15 minutes the first time.

**Prerequisites:**

- Node ≥ 20
- pnpm ≥ 9 (`npm i -g pnpm`)
- Docker Desktop (for the local Supabase stack) OR a Supabase project URL
- The Supabase CLI: `brew install supabase/tap/supabase` or [direct download](https://supabase.com/docs/guides/cli)

**Steps:**

1. Clone the repo and install deps:
   ```bash
   git clone <repo-url> scopeguard && cd scopeguard
   pnpm install
   ```
2. Start a local Supabase stack:
   ```bash
   supabase start
   ```
   Note the printed `API URL`, `anon key`, `service_role key`, and the `DB URL`.
3. Copy and fill the env file:
   ```bash
   cp .env.example .env.local
   ```
   Required for first run: Supabase block, `ANTHROPIC_API_KEY`, `ENCRYPTION_KEY`. Generate the encryption key with `openssl rand -hex 32`. Stripe/Postmark/Plaid can stay blank until you reach those features.
4. Apply migrations and seed:
   ```bash
   pnpm prisma:migrate
   pnpm prisma:seed
   ```
5. Run the dev servers in two terminals:
   ```bash
   pnpm dev                  # web app on :3000
   pnpm inngest:dev          # Inngest dev UI on :8288
   ```
6. Open http://localhost:3000 — landing page should render.

If anything fails, see § _Troubleshooting_ at the end of this document.

---

## 2. Deploying to production

ScopeGuard deploys to Vercel from `main`. CI runs typecheck + tests + lint on every PR; merge to `main` triggers Vercel.

**Pre-deploy checklist:**

- All migrations in `prisma/migrations/` have been reviewed for backward compatibility.
- `docs/CHANGELOG.md` has an entry for this release.
- No env vars referenced in the code are missing from Vercel.

**Manual deploy (rare):**

```bash
vercel --prod
```

**Post-deploy verification:**

1. Curl the health route: `curl https://app.scopeguard.app/api/health` — expect `{"ok":true}`.
2. Send a test inbound email to your alias and verify a ScopeCheck row appears.
3. Check Sentry for new error spikes.

---

## 3. Rolling back a bad deploy

```bash
vercel rollback <deployment-url>
```

If the bad deploy ran a migration: a forward-compatible "fix" migration is **always** preferable to rolling the schema back. Reverting a destructive migration risks data loss. See § _Database migrations_ for the escape hatch.

---

## 4. Running database migrations

**Local development:**

```bash
pnpm prisma:migrate            # creates + applies; prompts for a name
```

**Production:**

CI applies migrations during deploy via `pnpm prisma:migrate:deploy`. Never run `prisma migrate dev` against production — it can drop data.

**Rules:**

1. Migrations must be additive whenever possible (add nullable column, deploy, backfill, then mark NOT NULL in a later migration).
2. Renaming a column requires a 3-step deploy: add new column → dual-write + backfill → drop old column.
3. Every `userId`-bearing table requires RLS policies in the SAME migration file (see `20260427000100_enable_rls/migration.sql` for the template).

**Reverting:**

There is no `prisma migrate revert`. Write a follow-up migration that undoes the change.

---

## 5. Rotating secrets

| Secret              | Rotation cadence | Procedure                                                                                  |
| ------------------- | ---------------- | ------------------------------------------------------------------------------------------ |
| `ENCRYPTION_KEY`    | Quarterly        | See dedicated procedure below.                                                              |
| `STRIPE_WEBHOOK_SECRET` | After any leak | Stripe Dashboard → Webhooks → endpoint → Roll. Update Vercel env var, redeploy.             |
| `POSTMARK_SERVER_TOKEN` | Annually     | Postmark Server → API Tokens → Add new. Add to Vercel, deploy, then revoke the old one.     |
| `SUPABASE_SERVICE_ROLE_KEY` | After leak only | Supabase Dashboard → Settings → API → Reset. Update Vercel env, redeploy.            |
| `ANTHROPIC_API_KEY`     | Annually     | console.anthropic.com → API Keys → Create. Update Vercel, deploy, revoke old.               |

**`ENCRYPTION_KEY` rotation (zero-downtime):**

1. Generate the new key: `openssl rand -hex 32`.
2. Add it as `ENCRYPTION_KEY_NEW` in Vercel.
3. Deploy a one-shot Inngest function that reads each integration row, decrypts with the OLD key, re-encrypts with the NEW key, and writes back. (Function template: TBD — file an issue when you get here.)
4. Once the migration job reports zero rows remaining, swap: `ENCRYPTION_KEY := ENCRYPTION_KEY_NEW`, remove the `_NEW` var, redeploy.
5. The old key is now unused; do not delete it for at least 7 days in case of a rollback.

---

## 6. Adding a new payment integration

1. Add an enum value to `IntegrationSource` in `prisma/schema.prisma` and create a migration.
2. Add an env-var block in `.env.example` for the new credentials.
3. Build `lib/integrations/<name>.ts` with `connect()`, `syncTransactions()`, and `disconnect()`. Tokens MUST be encrypted with `lib/utils/encryption.ts` before write.
4. Add the OAuth callback route under `app/api/integrations/<name>/route.ts`.
5. Add an Inngest function to handle the periodic sync.
6. Add `<name>Card.tsx` under `components/finances/` and wire it into the integrations settings page.
7. Update `docs/openapi.yaml` and `docs/CHANGELOG.md`.

---

## 7. Investigating a Postmark inbound failure

Symptoms: a forwarded email never produced a ScopeCheck row.

1. Open Postmark → Servers → ScopeGuard → **Inbound** stream. Find the message by the user's alias.
2. Check the **Activity** tab → if the webhook delivery failed, click for response body.
3. If the webhook succeeded but no Inngest event ran, check Inngest Cloud → app `scopeguard` → function `processInboundEmail` and grep by Postmark MessageID.
4. Common causes:
   - User alias not in `users.inboundEmailAlias` → recipient mismatch.
   - User has no active project matching the sender's email → handler will park the message and email the user.
   - Contract not yet parsed → handler waits, then retries when `contract/uploaded` completes.

---

## 8. Investigating a Stripe webhook failure

1. Stripe Dashboard → Developers → **Webhooks** → endpoint → **Recent events**.
2. If `signature_verification_failed`, the `STRIPE_WEBHOOK_SECRET` env var doesn't match. Re-copy from the Stripe dashboard.
3. If the handler returned 5xx, the deploy logs in Vercel will show the structured `webhook.stripe.failed` log entry.
4. After fixing, click **Resend** in the Stripe dashboard.

---

## 9. Replaying a failed Inngest job

Inngest auto-retries with exponential backoff. After all retries exhaust:

1. Inngest Cloud → Runs → filter by `Failed`.
2. Click the run → **Replay**.
3. If the failure was a logic bug, fix it in code, redeploy, then replay.

---

## 10. Onboarding a new engineer

Day 1:
- Run § 1 (Local development setup).
- Read `README.md`, `docs/RUNBOOK.md`, `docs/adr/`.
- Read `prisma/schema.prisma` end-to-end.

Day 2:
- Pair on a small bug fix to learn the deploy loop.
- Create a Stripe test customer and step through a full subscribe → upgrade → cancel cycle in test mode.

---

## Storage bucket setup (one-time)

The contract upload pipeline expects a private Storage bucket named `contracts`. Create it once per environment:

```sql
-- Run in the Supabase SQL editor against your project.
insert into storage.buckets (id, name, public)
values ('contracts', 'contracts', false)
on conflict (id) do nothing;
```

Object keys are written under `<userId>/<projectId>/<uuid>.<ext>` by `lib/contracts/storage.ts`. The app uses the service-role client for Storage reads/writes; the user's browser only ever receives signed URLs (15-minute TTL by default).

## Troubleshooting

**`Error: ENCRYPTION_KEY env var is required`** — set it in `.env.local` (`openssl rand -hex 32`).

**Prisma "P1001: Can't reach database"** — Supabase isn't running, or `DATABASE_URL` points at the pooled port (6543) when the migration command needs the direct port (5432). Use `DATABASE_URL` for migrations and `DATABASE_POOL_URL` for runtime.

**RLS denying queries that worked yesterday** — you probably added a new column without updating the policy. Check `prisma/migrations/*_enable_rls/`.
