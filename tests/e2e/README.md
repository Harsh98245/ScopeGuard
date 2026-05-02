# ScopeGuard E2E suite

Playwright tests covering the critical user flows: signup/login, project + contract management, manual scope checks, the inbox feed, billing, plan-gates, the Financial OS, and integrations.

## Layout

```
tests/e2e/
├── fixtures/
│   ├── auth.ts          ← Supabase admin helpers (ensureTestUser, setUserPlanTier)
│   ├── seed.ts          ← Insert projects, scope checks, transactions via service role
│   └── mocks.ts          ← Playwright page.route() mocks for AI / Stripe / Plaid
├── global-setup.ts       ← Provisions test user + storageState before any spec runs
├── public/               ← Specs that DO NOT need authentication
│   ├── landing.spec.ts
│   └── auth-forms.spec.ts
└── auth/                 ← Specs that run with the persisted storageState
    ├── projects.spec.ts
    ├── scope-check.spec.ts
    ├── inbox.spec.ts
    ├── billing.spec.ts
    ├── plan-gate.spec.ts
    ├── finances.spec.ts
    └── integrations.spec.ts
```

The two project shapes in `playwright.config.ts` (`chromium-public`, `chromium-auth`) keep the runs separated so a missing storageState skips only the auth suite.

## Running locally

### Prerequisites

```bash
# Install Playwright browsers once (the first time you clone the repo).
pnpm exec playwright install --with-deps
```

A running local Supabase + filled `.env.local` with at least:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ENCRYPTION_KEY=<64-hex>
```

The service-role key is required for the global setup to provision the test user. Without it the auth-protected specs auto-skip with a friendly warning.

### Run the suite

```bash
# All projects (chromium-public + chromium-auth).
pnpm test:e2e

# Just the public surface.
pnpm test:e2e --project=chromium-public

# Just one spec.
pnpm test:e2e auth/billing.spec.ts

# Headed mode for local debugging.
pnpm test:e2e --headed
```

Playwright auto-boots `pnpm dev` (see `webServer` in `playwright.config.ts`) and reuses an already-running dev server when present.

### Cross-browser

Firefox + WebKit projects only register when `CI=true`, so local runs stay fast. To opt-in locally set `CI=1 pnpm test:e2e`.

## Mocked vs live external services

| Service     | Default behaviour | Override                                       |
| ----------- | ----------------- | ---------------------------------------------- |
| Anthropic   | Mocked via `mockManualScopeCheck` in scope-check spec. | Remove the mock to hit the real API.           |
| Stripe Checkout / Portal | Intercepted at `https://checkout.stripe.com/**` and `https://billing.stripe.com/**`. | Remove the route mock and use Stripe test mode + a live test customer. |
| Stripe Connect | Intercepted at `/api/integrations/STRIPE/connect` with a fake URL. | Replace with real Connect client_id to drive a sandbox flow. |
| Postmark    | Inbound webhooks are not exercised in E2E (require external delivery). | Use `curl` against `/api/webhooks/postmark` with a signed payload from `tests/fixtures/postmark.ts`. |

## Test-data hygiene

The default `e2e-user@scopeguard.test` is shared across runs; specs create per-test projects/transactions with unique identifiers (`Date.now()`-suffixed) so reruns don't collide.

When data accumulates, wipe the user via the Supabase dashboard or:

```sql
delete from auth.users where email = 'e2e-user@scopeguard.test';
-- ON DELETE CASCADE wipes every owned row.
```

`global-setup.ts` will recreate it on the next run.

## CI integration

The GitHub Actions workflow boots a Supabase + Postgres service container, applies migrations, and runs `pnpm test:e2e`. Cross-browser projects are enabled via the `CI=true` env var.

Failures upload the Playwright HTML report + trace + video to the run artefacts so flake hunters have full context.

## Adding a new spec

1. Decide whether it needs authentication. If yes, place it under `tests/e2e/auth/`; otherwise `tests/e2e/public/`.
2. Import fixtures from `../fixtures/{auth,seed,mocks}`. Use the existing helpers — never craft Supabase admin client calls inline.
3. If the spec depends on env state (a particular `planTier`, a seeded contract, etc.), set it up in `test.beforeAll` or `test.beforeEach` and undo it in `afterAll` / `afterEach`.
4. Mock any external API via `mocks.ts` — never call the real Anthropic or Stripe API from a spec.
