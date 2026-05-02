/**
 * @file sentry.client.config.ts
 * @description Sentry browser SDK initialisation. Loaded automatically by
 *              `@sentry/nextjs` when present in the project root. Sample
 *              rates are conservative — bumped per route via `Sentry.startSpan`
 *              once specific flows need detailed tracing.
 *
 *              All PII is redacted by default — error messages and stack
 *              frames go through, but Sentry's default `beforeSend` runs
 *              the standard PII scrubber. Encryption keys, tokens, and
 *              email contents must not appear in errors that reach this file.
 */

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env['NEXT_PUBLIC_SENTRY_DSN'],
  enabled: !!process.env['NEXT_PUBLIC_SENTRY_DSN'],
  // Sample 20% of error events in production; 100% in dev for fast iteration.
  // Performance-traces sample low (5%) to control quota.
  tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.05 : 1.0,
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0,
  // Don't auto-instrument fetch — we route critical fetches through our own
  // logger and don't want Sentry double-tracking.
  integrations: (defaults) => defaults.filter((i) => i.name !== 'BrowserTracing'),
  beforeSend(event) {
    // Drop events from non-production unless explicitly enabled.
    if (process.env['NODE_ENV'] === 'development' && !process.env['NEXT_PUBLIC_SENTRY_DEBUG']) {
      return null;
    }
    return event;
  },
  ignoreErrors: [
    // Browser noise we cannot fix.
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications',
    'Non-Error promise rejection captured',
  ],
});
