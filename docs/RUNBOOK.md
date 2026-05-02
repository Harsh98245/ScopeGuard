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

## Postmark setup (one-time)

The inbound email pipeline depends on a Postmark Server with inbound forwarding configured for the domain in `INBOUND_EMAIL_DOMAIN` (default `inbound.scopeguard.app`). One-time setup:

1. **Create a Postmark Server** at postmarkapp.com → Servers → New. Track the Server Token in `POSTMARK_SERVER_TOKEN`.
2. **Verify the outbound sender domain** (matches `OUTBOUND_FROM_EMAIL`'s domain). DNS records (DKIM + Return-Path) must be added before Postmark will deliver.
3. **Configure inbound**: Server → Inbound stream → Settings.
   - **Inbound webhook URL**: `https://app.scopeguard.app/api/webhooks/postmark`.
   - **Custom HTTP headers**: add a header named `X-Postmark-Signature` with the value of `POSTMARK_WEBHOOK_SECRET` (Postmark echoes the header verbatim on every webhook). Generate the secret with `openssl rand -hex 32`.
   - **Inbound domain**: point `MX 10 inbound.postmarkapp.com.` from your `INBOUND_EMAIL_DOMAIN` (e.g. `inbound.scopeguard.app`). DNS propagation can take up to an hour.
4. **Smoke-test**: from any email client, send a message to `whatever@inbound.scopeguard.app`. Postmark → Servers → Inbound stream → Activity should show the message; Inngest Cloud should show a `scope/email.received` event followed by a `process-inbound-email` run.

If the webhook returns 401, the `X-Postmark-Signature` header value doesn't match `POSTMARK_WEBHOOK_SECRET`. Re-copy from the Postmark dashboard.

## Production hardening checklist

Run through this list before flipping a new environment to "production". Each item links to the file or dashboard that owns the configuration.

### Observability

- [ ] **Sentry project created**, DSN copied to:
  - `SENTRY_DSN` (server runtime)
  - `NEXT_PUBLIC_SENTRY_DSN` (browser SDK)
  - `SENTRY_AUTH_TOKEN` (source-map upload during build — optional but recommended)
- [ ] `pnpm add @sentry/nextjs` (the wrappers gracefully no-op without the package, but production needs it).
- [ ] Throw a synthetic error from `/settings` to confirm capture lands in Sentry:
  ```ts
  // Inside a server component, just for the smoke test.
  throw new Error('e2e-sentry-smoke');
  ```
- [ ] **PostHog project created**, key copied to:
  - `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (browser SDK)
  - `POSTHOG_API_KEY` (server-side `posthog-node`)
- [ ] `pnpm add posthog-js posthog-node`.
- [ ] Smoke-test by signing in and watching the user appear in PostHog → People.

### Rate limits

- [ ] **Upstash Redis instance provisioned**, REST URL + token in env (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`).
- [ ] Verify per-user limiters are active by hammering `/api/scope/check` 50 times — request 51 should return 429.
- [ ] Verify the webhook IP limiter is active by replaying a Postmark inbound 600 times from the Stripe CLI — request 601 should return 429.

### Health & readiness

- [ ] `curl https://app.scopeguard.app/api/health` returns 200 with `{ "ok": true, "version": "..." }`.
- [ ] `curl https://app.scopeguard.app/api/health?deep=1` returns 200 with `checks.{database,redis,env}.ok = true` for all three. Returns 503 if any required env var is missing.
- [ ] Hook the deep endpoint into your external uptime monitor (Uptime Kuma, Better Stack, Vercel Monitoring).

### Vercel deploy configuration

- [ ] **Region** matches `vercel.json` (`iad1` by default).
- [ ] Per-route `maxDuration` values from `vercel.json` are accepted by the Vercel plan (Pro+ for the 30s scope-check timeout).
- [ ] Inngest production app configured separately at app.inngest.com — Vercel cron is NOT used; Inngest schedules `cron/sync-transactions.tick` itself.
- [ ] `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` set in Vercel env (production Inngest app).

### Security headers

- [ ] CSP report verified via `curl -I https://app.scopeguard.app/` — ensure no third-party domain you actually use is blocked. Add to `next.config.ts → buildCsp()` if so.
- [ ] HSTS shows `max-age=63072000; includeSubDomains; preload` (already configured).
- [ ] Submit the apex domain to https://hstspreload.org/ for browser-baked HSTS.

### Secrets rotation cadence

| Secret | Cadence | Procedure |
| --- | --- | --- |
| `ENCRYPTION_KEY` | Quarterly | Re-encryption Inngest job — see `## 5. Rotating secrets` above. |
| `STRIPE_SECRET_KEY` | After leak only | Stripe Dashboard → Developers → Keys → roll. |
| `SUPABASE_SERVICE_ROLE_KEY` | After leak only | Supabase Dashboard → Settings → API → reset. |
| `POSTMARK_SERVER_TOKEN` | Annually | See § 5. |
| `ANTHROPIC_API_KEY` | Annually | See § 5. |

---

## Integrations setup (one-time per provider)

The Financial OS auto-syncs transactions from Stripe Connect, PayPal, and Plaid.
Each provider needs developer credentials configured in the env before users can connect.

### Stripe Connect

1. **Register a Connect platform** at Dashboard → Connect → Settings → "Apply" if not already enrolled.
2. **Configure OAuth** at Dashboard → Connect → Settings → OAuth:
   - Redirect URI: `https://app.scopeguard.app/api/integrations/STRIPE/callback`
   - For local dev: also add `http://localhost:3000/api/integrations/STRIPE/callback`.
3. Copy the OAuth client_id (looks like `ca_…`) into `STRIPE_CONNECT_CLIENT_ID`.
4. The platform's `STRIPE_SECRET_KEY` (already configured for subscriptions billing) is reused for the OAuth code exchange.

### PayPal

1. Create an app at developer.paypal.com → Apps & Credentials → Create App (REST API). Use the sandbox flavour for development.
2. Enable the "Log In with PayPal" feature inside the app and request the `https://uri.paypal.com/services/reporting/search/read` scope.
3. Set the return URL to `https://app.scopeguard.app/api/integrations/PAYPAL/callback`.
4. Capture the credentials:
   - `PAYPAL_CLIENT_ID`
   - `PAYPAL_CLIENT_SECRET`
   - `PAYPAL_ENV=sandbox` (or `live`)

### Plaid

1. Sign up at dashboard.plaid.com — sandbox is free and unlimited.
2. Capture credentials:
   - `PLAID_CLIENT_ID`
   - `PLAID_SECRET`
   - `PLAID_ENV=sandbox` (or `development` or `production`)
3. Install the React SDK in the app: `pnpm add react-plaid-link`. The `ConnectButton` client island dynamically imports it; without it, clicking Connect for Plaid surfaces a loud error.
4. Whitelist your callback domain (Plaid Link is in-page, so no OAuth redirect URL is needed — just the domain you'll run the app on).

### Verify the connect flow end-to-end

1. Sign in as a PRO user.
2. Visit `/settings/integrations`. Click Connect on the provider.
3. Approve at the provider's consent screen.
4. You should land back at `/settings/integrations?connected=<SOURCE>`.
5. Check the Integration row in SQL: `select source, "lastSyncedAt", metadata from integrations where "userId" = '<id>';`
6. Within ~1 minute, INCOME or EXPENSE rows should appear in the Transactions list.

If the callback returns `?error=callback_failed`, check the structured logs for `integrations.callback.failed` — the `message` field has the provider error.

---

## Stripe setup (one-time)

The billing surface (`/settings/billing`) depends on a configured Stripe account
with three subscription products and a webhook endpoint. One-time setup:

1. **Create the products + prices** in Stripe Dashboard → Products. Each plan
   needs a recurring monthly price. Capture the price IDs into env vars:
   - `STRIPE_STARTER_PRICE_ID` — Starter, $19/month
   - `STRIPE_PRO_PRICE_ID` — Pro, $39/month
   - `STRIPE_BUSINESS_PRICE_ID` — Business, $69/month
2. **Configure the Customer Portal** at Dashboard → Settings → Billing → Customer Portal:
   - Allow customers to update payment methods + cancel.
   - Allow plan switching across the three products above.
   - Set the default return URL to `https://app.scopeguard.app/settings/billing`.
3. **Set up the webhook** at Dashboard → Developers → Webhooks → Add endpoint:
   - URL: `https://app.scopeguard.app/api/webhooks/stripe`.
   - Events: `checkout.session.completed`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
   - Capture the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. **Set the API key** at Dashboard → Developers → API keys:
   - Copy the secret key into `STRIPE_SECRET_KEY` (use a restricted key in production
     limited to: customers RW, checkout sessions RW, billing portal sessions RW,
     subscriptions R, invoices R, webhook endpoints R).
5. **Local development**: install the Stripe CLI and run
   `stripe listen --forward-to localhost:3000/api/webhooks/stripe` to forward
   live events to your local box. The CLI prints a `whsec_…` signing secret —
   put it in `.env.local` as `STRIPE_WEBHOOK_SECRET` for the dev session.
6. **Smoke-test**: hit `/settings/billing` while signed in, click Upgrade on
   any plan, complete checkout with test card `4242 4242 4242 4242`. Within a
   few seconds the user row's `planTier` should flip; verify in the SQL editor:
   ```sql
   select id, email, "planTier", "subscriptionStatus", "currentPeriodEnd"
     from users where email = 'you@example.com';
   ```

If the webhook returns 401, `STRIPE_WEBHOOK_SECRET` doesn't match the dashboard
value. If checkout returns 503, one of `STRIPE_*_PRICE_ID` is missing.

---

## Enabling Realtime for scope_checks (one-time)

The `/inbox` feed uses Supabase Realtime to push new verdicts without a page reload.
The `scope_checks` table must be added to the Supabase realtime publication once per environment:

```sql
-- Run in the Supabase SQL editor against your project.
alter publication supabase_realtime add table scope_checks;
```

After this, any INSERT to `scope_checks` will be broadcast to subscribers.
RLS policies on `scope_checks` are respected — clients receive only the rows their
JWT is allowed to SELECT. If Realtime is not enabled the inbox still works; it just
requires a manual page refresh to see new verdicts.

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
