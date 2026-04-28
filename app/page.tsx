/**
 * @file app/page.tsx
 * @description Marketing landing page placeholder. Replaced in a future
 *              session with the full hero/features/pricing surface. For now
 *              it confirms the scaffold renders end-to-end.
 */

import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col items-start justify-center gap-8 px-6 py-24">
      <div className="space-y-4">
        <span className="inline-flex items-center rounded-full border border-border px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">
          Beta · Built for freelancers
        </span>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Stop scope creep before it costs you another weekend.
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          ScopeGuard reads your contract, watches your client emails, and tells
          you the second a request crosses the line. Plus a plain-English P&L
          so taxes never surprise you again.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/signup"
          className="inline-flex h-11 items-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          Start free
        </Link>
        <Link
          href="/login"
          className="inline-flex h-11 items-center rounded-md border border-border px-6 text-sm font-medium hover:bg-secondary"
        >
          Log in
        </Link>
      </div>

      <p className="text-xs text-muted-foreground">
        v0.1.0 · scaffold complete · feature build in progress.
      </p>
    </main>
  );
}
