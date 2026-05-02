/**
 * @file instrumentation.ts
 * @description Next.js instrumentation hook. Runs once when the Node or Edge
 *              runtime cold-starts. Used to bootstrap Sentry — required for
 *              the modern @sentry/nextjs setup that no longer auto-loads
 *              `sentry.{server,edge}.config.ts` from the project root.
 *
 *              When `SENTRY_DSN` is unset the imports still execute but
 *              `Sentry.init({ enabled: false })` makes them effectively a
 *              no-op so this module is safe to keep enabled in dev.
 */

export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env['NEXT_RUNTIME'] === 'edge') {
    await import('./sentry.edge.config');
  }
}

/**
 * Optional hook — `@sentry/nextjs` recommends re-throwing in
 * `onRequestError` so server components surface errors with full context.
 */
export async function onRequestError(
  err: unknown,
  request: Request,
  context: { routerKind: string; routePath: string; routeType: string },
): Promise<void> {
  if (!process.env['SENTRY_DSN']) return;
  try {
    const sentry = (await import('@sentry/nextjs')) as unknown as {
      captureRequestError: (err: unknown, request: Request, context: unknown) => void;
    };
    sentry.captureRequestError(err, request, context);
  } catch {
    // Sentry not installed — fine.
  }
}
