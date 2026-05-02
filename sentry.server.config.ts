/**
 * @file sentry.server.config.ts
 * @description Sentry Node SDK init for the server runtime (App Router
 *              server components, route handlers, server actions). Loaded
 *              by `instrumentation.ts`'s `register()` hook.
 */

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env['SENTRY_DSN'],
  enabled: !!process.env['SENTRY_DSN'],
  tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.05 : 1.0,
  // Server-side Sentry strips request bodies by default; keep it that way to
  // avoid leaking encryption tokens / contract text / email content.
  sendDefaultPii: false,
  beforeSend(event) {
    if (process.env['NODE_ENV'] === 'development' && !process.env['SENTRY_DEBUG']) {
      return null;
    }
    return event;
  },
});
