'use client';

/**
 * @file app/error.tsx
 * @description Per-route error boundary. Captures the error to Sentry on
 *              mount (best-effort dynamic import so unwired environments
 *              still render the message), surfaces a generic copy + a "try
 *              again" CTA. Renders the digest so the user can quote it in
 *              support.
 *
 *              For root-layout failures, see `app/global-error.tsx`.
 */

import { useEffect } from 'react';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({ level: 'error', msg: 'app.error.boundary', digest: error.digest }),
    );
    void (async () => {
      try {
        const sentry = (await import('@sentry/nextjs')) as unknown as {
          captureException: (e: unknown, hint?: unknown) => string;
        };
        sentry.captureException(error, { tags: { boundary: 'route' } });
      } catch {
        // Sentry not installed — fine.
      }
    })();
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-muted-foreground">
        We have been notified and will look into it. Please try again.
      </p>
      {error.digest && (
        <p className="text-xs text-muted-foreground">
          Reference: <span className="font-mono">{error.digest}</span>
        </p>
      )}
      <button
        type="button"
        onClick={reset}
        className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground"
      >
        Try again
      </button>
    </main>
  );
}
