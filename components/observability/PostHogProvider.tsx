/**
 * @file components/observability/PostHogProvider.tsx
 * @description Client-side PostHog SDK bootstrap. Mounted once at the
 *              root of the app (in `app/layout.tsx`) so every page is
 *              captured automatically. Identifies the signed-in user
 *              when their id is supplied.
 *
 *              When `NEXT_PUBLIC_POSTHOG_KEY` is unset (dev / preview
 *              without analytics), the provider renders children but
 *              never loads the SDK — useful for local iteration.
 */

'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

interface PostHogProviderProps {
  /** Distinct user identifier. Pass null when signed out. */
  distinctId?: string | null;
  /** Optional profile fields to send with `identify`. */
  identity?: Record<string, unknown>;
  children: React.ReactNode;
}

interface PostHogClient {
  init(key: string, opts: Record<string, unknown>): void;
  capture(event: string, properties?: Record<string, unknown>): void;
  identify(distinctId: string, properties?: Record<string, unknown>): void;
  reset(): void;
  __loaded?: boolean;
}

let bootstrapped = false;

export function PostHogProvider({ distinctId, identity, children }: PostHogProviderProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Bootstrap once.
  useEffect(() => {
    if (bootstrapped) return;
    const key = process.env['NEXT_PUBLIC_POSTHOG_KEY'];
    if (!key) return;
    bootstrapped = true;

    void (async () => {
      try {
        const mod = (await import('posthog-js')) as unknown as { default: PostHogClient };
        const posthog = mod.default;
        posthog.init(key, {
          api_host: process.env['NEXT_PUBLIC_POSTHOG_HOST'] ?? 'https://us.i.posthog.com',
          capture_pageview: false, // we drive these manually below for App Router
          person_profiles: 'identified_only',
        });
      } catch {
        // posthog-js not installed (CI without analytics) — silent skip.
      }
    })();
  }, []);

  // Identify on user-id change.
  useEffect(() => {
    if (!distinctId) return;
    void (async () => {
      const mod = (await import('posthog-js').catch(() => null)) as { default: PostHogClient } | null;
      if (!mod?.default?.__loaded) return;
      mod.default.identify(distinctId, identity);
    })();
  }, [distinctId, identity]);

  // Manual pageview capture — App Router doesn't fire the SDK's auto-pageview.
  useEffect(() => {
    if (!pathname) return;
    void (async () => {
      const mod = (await import('posthog-js').catch(() => null)) as { default: PostHogClient } | null;
      if (!mod?.default?.__loaded) return;
      const url = searchParams?.toString()
        ? `${pathname}?${searchParams.toString()}`
        : pathname;
      mod.default.capture('$pageview', { $current_url: url });
    })();
  }, [pathname, searchParams]);

  return <>{children}</>;
}
