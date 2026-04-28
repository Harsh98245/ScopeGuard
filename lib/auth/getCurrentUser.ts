/**
 * @file lib/auth/getCurrentUser.ts
 * @description Server-side helper that returns the currently authenticated
 *              ScopeGuard user (the row from our `users` table, NOT the bare
 *              Supabase auth user). Designed to be called from Server
 *              Components, route handlers, and server actions.
 *
 *              Returns `null` when no user is signed in. Callers that
 *              require authentication should use {@link requireCurrentUser}
 *              which throws — never silently 200 on an unauthenticated
 *              request.
 */

import 'server-only';

import { redirect } from 'next/navigation';
import type { User } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Look up the signed-in user's profile row.
 *
 * @returns The User record matching the Supabase session, or `null` if
 *          either no session is present or the auth user has not yet had
 *          a profile row created (rare — happens between the auth callback
 *          and the first dashboard render).
 *
 * @example
 *   const user = await getCurrentUser();
 *   if (!user) return <p>Please sign in.</p>;
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return null;

  return prisma.user.findUnique({ where: { id: authUser.id } });
}

/**
 * Same as {@link getCurrentUser} but redirects to /login when no user is
 * signed in. Use from Server Components for authenticated pages — the
 * middleware will already have redirected, but this is the belt-and-braces
 * fallback that also satisfies the type system (the return type is
 * non-nullable).
 *
 * @param redirectTo - Path to send the user back to after login.
 * @returns The non-null User row.
 */
export async function requireCurrentUser(redirectTo: string = '/projects'): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(redirectTo)}`);
  }
  return user;
}
