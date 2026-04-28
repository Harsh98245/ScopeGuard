# Changelog

All notable changes to ScopeGuard are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
