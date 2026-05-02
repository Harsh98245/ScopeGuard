'use client';

/**
 * @file app/global-error.tsx
 * @description Last-resort error boundary that catches failures inside the
 *              ROOT layout (where `app/error.tsx` cannot run because the
 *              layout itself failed to render). Must include its own
 *              `<html>` and `<body>` tags — there's no parent layout left.
 *
 *              Captures to Sentry via dynamic import so unwired environments
 *              still render the message.
 */

import { useEffect } from 'react';

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void (async () => {
      try {
        const sentry = (await import('@sentry/nextjs')) as unknown as {
          captureException: (e: unknown, hint?: unknown) => string;
        };
        sentry.captureException(error, { tags: { boundary: 'global' } });
      } catch {
        // Sentry not installed — fine.
      }
    })();
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          background: '#fff',
          color: '#111',
        }}
      >
        <main
          style={{
            margin: '0 auto',
            maxWidth: 480,
            padding: '5rem 1.5rem',
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontSize: 28, fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ color: '#555', marginTop: 12 }}>
            The app failed to load. Our team has been notified — please refresh
            the page in a moment.
          </p>
          {error.digest && (
            <p style={{ marginTop: 20, fontSize: 12, color: '#888' }}>
              Reference: <code>{error.digest}</code>
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
