'use client';

/**
 * @file app/error.tsx
 * @description Root error boundary. Surfaces a generic message and a "try
 *              again" button. Errors are reported to Sentry via Next's built-in
 *              integration when SENTRY_DSN is configured.
 */

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the digest in dev so users can grep production logs by it.
    // No sensitive payload — `digest` is opaque.
    console.error(JSON.stringify({ level: 'error', msg: 'app.error.boundary', digest: error.digest }));
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-muted-foreground">
        We have been notified and will look into it. Please try again.
      </p>
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
