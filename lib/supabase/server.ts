/**
 * @file lib/supabase/server.ts
 * @description Server-side Supabase client wired to the Next.js cookie store.
 *              Token refresh, login state, and auth.uid() used by RLS all flow
 *              through these cookies.
 *
 *              Use {@link createSupabaseServerClient} from server components,
 *              route handlers, and server actions.
 *
 *              For server-only code paths that must bypass RLS (Stripe webhook,
 *              Postmark webhook lookup-by-alias), use {@link createSupabaseAdminClient}
 *              which uses the service role key.
 */

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient as createPlainClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

/**
 * Create a request-scoped Supabase client that respects the user's JWT.
 * Reads/writes cookies via Next.js's `cookies()` store so the SSR session
 * stays in sync with the browser.
 *
 * @returns SupabaseClient with the user's auth context.
 */
export function createSupabaseServerClient(): SupabaseClient {
  const cookieStore = cookies();

  return createServerClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Server Components are read-only — Supabase tolerates this and
            // refresh-token rotation will retry on the next request.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            // See note above.
          }
        },
      },
    },
  );
}

/**
 * Service-role Supabase client. Bypasses RLS — only use server-side, only when
 * you genuinely need cross-user access (webhook handlers, system-level cron
 * jobs). Never construct this on a request path that handles untrusted input
 * without first authenticating the caller.
 *
 * @returns SupabaseClient configured with the service role key.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  return createPlainClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
