# Changelog

All notable changes to ScopeGuard are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
