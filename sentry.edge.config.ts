/**
 * @file sentry.edge.config.ts
 * @description Sentry init for the Edge runtime (middleware.ts). Edge
 *              runtimes have a smaller SDK surface — performance tracing
 *              is automatic; we only need DSN + sample rate config.
 */

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env['SENTRY_DSN'],
  enabled: !!process.env['SENTRY_DSN'],
  tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.02 : 1.0,
});
