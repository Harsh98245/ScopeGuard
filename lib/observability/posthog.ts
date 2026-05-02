/**
 * @file lib/observability/posthog.ts
 * @description Server-side PostHog event helper. The browser SDK is loaded
 *              via `components/observability/PostHogProvider.tsx`; this
 *              module handles backend-emitted events (e.g. `scope.verdict`,
 *              `billing.checkout.started`) so they're attributed even when
 *              the user closes the tab before the next pageview.
 *
 *              Identification: pass the User.id as `distinctId` so events
 *              tie to the same person across sessions/devices.
 *
 *              Soft-skip: when `POSTHOG_API_KEY` is unset, every helper
 *              is a no-op so dev / CI runs cleanly.
 */

import 'server-only';

interface PostHogAdapter {
  capture(event: string, distinctId: string, properties?: Record<string, unknown>): void;
  identify(distinctId: string, properties?: Record<string, unknown>): void;
  shutdown(): Promise<void>;
}

let cached: PostHogAdapter | null = null;

async function loadAdapter(): Promise<PostHogAdapter> {
  if (cached) return cached;
  if (!process.env['POSTHOG_API_KEY']) {
    cached = noop();
    return cached;
  }
  try {
    const { PostHog } = (await import('posthog-node')) as unknown as {
      PostHog: new (
        apiKey: string,
        opts: { host?: string; flushAt?: number; flushInterval?: number },
      ) => {
        capture(args: { event: string; distinctId: string; properties?: Record<string, unknown> }): void;
        identify(args: { distinctId: string; properties?: Record<string, unknown> }): void;
        shutdown(): Promise<void>;
      };
    };

    const client = new PostHog(process.env['POSTHOG_API_KEY']!, {
      host: process.env['NEXT_PUBLIC_POSTHOG_HOST'] ?? 'https://us.i.posthog.com',
      // Tight flush so server-side events surface in real time during dev.
      flushAt: 1,
      flushInterval: 1000,
    });

    cached = {
      capture: (event, distinctId, properties) => client.capture({ event, distinctId, properties }),
      identify: (distinctId, properties) => client.identify({ distinctId, properties }),
      shutdown: () => client.shutdown(),
    };
  } catch {
    cached = noop();
  }
  return cached;
}

function noop(): PostHogAdapter {
  return {
    capture: () => {},
    identify: () => {},
    shutdown: () => Promise.resolve(),
  };
}

/**
 * Capture a server-side product event.
 *
 * @param event       - Event name. Use dotted lowercase, e.g. `scope.verdict`.
 * @param distinctId  - Stable user identifier (User.id).
 * @param properties  - Optional event properties. Avoid logging PII or tokens.
 */
export function captureEvent(
  event: string,
  distinctId: string,
  properties?: Record<string, unknown>,
): void {
  void loadAdapter().then((a) => a.capture(event, distinctId, properties));
}

/** Tie a distinctId to a profile (email, planTier). Call once per session. */
export function identify(distinctId: string, properties?: Record<string, unknown>): void {
  void loadAdapter().then((a) => a.identify(distinctId, properties));
}
