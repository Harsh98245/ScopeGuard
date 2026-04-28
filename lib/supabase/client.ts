/**
 * @file lib/supabase/client.ts
 * @description Browser-side Supabase client. Uses the anon key — RLS policies
 *              enforce per-user access. Safe to import from `'use client'`
 *              components.
 */

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Create a Supabase client suitable for use in client components.
 * Memoise per-render rather than module-scope so HMR picks up env changes.
 *
 * @returns A SupabaseClient bound to the anon key.
 */
export function createSupabaseBrowserClient(): SupabaseClient {
  return createBrowserClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
  );
}
