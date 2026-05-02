/**
 * @file lib/observability/sentry.ts
 * @description Server-side Sentry wrappers. We re-export only the surface
 *              the rest of the codebase needs (`captureException`,
 *              `captureMessage`, `addBreadcrumb`) so swapping providers in
 *              the future requires changing one file rather than 30
 *              direct `@sentry/nextjs` imports.
 *
 *              When `SENTRY_DSN` is unset (local dev, CI), every helper is
 *              a no-op — the @sentry/nextjs SDK already short-circuits
 *              cleanly without DSN, but we add an extra guard so the wrapper
 *              works even before the SDK is installed.
 */

import 'server-only';

interface SentryAdapter {
  captureException(err: unknown, context?: Record<string, unknown>): void;
  captureMessage(message: string, level?: 'info' | 'warning' | 'error'): void;
  addBreadcrumb(crumb: { category: string; message: string; data?: Record<string, unknown> }): void;
  setUser(user: { id: string; email?: string } | null): void;
}

let cached: SentryAdapter | null = null;

/**
 * Lazy-load `@sentry/nextjs`. Returns a no-op adapter if the package isn't
 * installed (development, CI without DSN) or if SENTRY_DSN is missing.
 */
async function loadAdapter(): Promise<SentryAdapter> {
  if (cached) return cached;
  if (!process.env['SENTRY_DSN']) {
    cached = noopAdapter();
    return cached;
  }
  try {
    const sentry = (await import('@sentry/nextjs')) as unknown as {
      captureException: (err: unknown, hint?: unknown) => string;
      captureMessage: (msg: string, level?: 'info' | 'warning' | 'error') => string;
      addBreadcrumb: (b: { category?: string; message?: string; data?: Record<string, unknown> }) => void;
      setUser: (user: { id?: string; email?: string } | null) => void;
    };
    cached = {
      captureException: (err, context) =>
        void sentry.captureException(err, context ? { extra: context } : undefined),
      captureMessage: (msg, level) => void sentry.captureMessage(msg, level),
      addBreadcrumb: (crumb) => sentry.addBreadcrumb(crumb),
      setUser: (user) => sentry.setUser(user),
    };
  } catch {
    cached = noopAdapter();
  }
  return cached;
}

function noopAdapter(): SentryAdapter {
  return {
    captureException: () => {},
    captureMessage: () => {},
    addBreadcrumb: () => {},
    setUser: () => {},
  };
}

/**
 * Report an exception. Fire-and-forget — we never await Sentry from request
 * paths because a slow Sentry never blocks user requests.
 */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  void loadAdapter().then((a) => a.captureException(err, context));
}

/** Report a structured message (used for warnings that aren't thrown errors). */
export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
  void loadAdapter().then((a) => a.captureMessage(message, level));
}

/** Add a breadcrumb so the next exception in this request includes context. */
export function addBreadcrumb(category: string, message: string, data?: Record<string, unknown>): void {
  void loadAdapter().then((a) => a.addBreadcrumb({ category, message, data }));
}

/** Tag the current scope with the signed-in user. Call once per request. */
export function setSentryUser(user: { id: string; email?: string } | null): void {
  void loadAdapter().then((a) => a.setUser(user));
}

/** Reset the cached adapter — test-only. */
export function _resetSentryAdapterForTests(): void {
  cached = null;
}
