/**
 * @file tests/e2e/fixtures/auth.ts
 * @description Supabase admin helpers for the E2E suite. Creates and deletes
 *              test users via the service-role API so specs can assume a
 *              clean, signed-in state without going through the email-confirm
 *              flow on every run.
 *
 *              The helpers REQUIRE these env vars at run time:
 *                - NEXT_PUBLIC_SUPABASE_URL
 *                - SUPABASE_SERVICE_ROLE_KEY
 *
 *              When either is missing, every helper throws — the
 *              global-setup hook is responsible for surfacing a friendly
 *              "skipping auth-dependent tests" message in that case.
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/** Stable email used by the default authenticated test user. */
export const E2E_USER_EMAIL = 'e2e-user@scopeguard.test';
export const E2E_USER_PASSWORD = 'TestPassword!123';

interface AdminClient {
  url: string;
  key: string;
}

function adminEnv(): AdminClient {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    throw new Error(
      'E2E auth helpers require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }
  return { url, key };
}

function adminClient() {
  const { url, key } = adminEnv();
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Idempotently create a test user with a known password and confirmed email.
 * Returns the auth UUID, which matches `users.id` in the public schema once
 * `ensureUserProfile` runs on the first authenticated request.
 *
 * @param email    - Email address — pass a unique value per spec to keep tests independent.
 * @param password - Password to set.
 * @returns The Supabase auth user ID.
 */
export async function ensureTestUser(
  email: string = E2E_USER_EMAIL,
  password: string = E2E_USER_PASSWORD,
): Promise<string> {
  const supabase = adminClient();

  // Look up by email first — admin.listUsers paginates, so for a small test
  // pool we filter the first page. Production-scale auth tables would use
  // a different lookup path.
  const { data: list, error: listError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listError) throw listError;

  const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) return existing.id;

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;
  if (!created.user) throw new Error('Supabase did not return a user.');
  return created.user.id;
}

/**
 * Hard-delete a test user via the admin API. Cascades through the public
 * `users` row + every owned record because of `onDelete: Cascade` in the
 * Prisma schema.
 *
 * @param userId - Supabase auth user ID.
 */
export async function deleteTestUser(userId: string): Promise<void> {
  const supabase = adminClient();
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error && !error.message.toLowerCase().includes('not found')) {
    throw error;
  }
}

/**
 * Update the public `users.planTier` column for an already-signed-up test
 * user. Used by plan-gate specs to flip a user between FREE / STARTER / PRO
 * without going through Stripe.
 *
 * @param userId   - Supabase auth user ID (also the public users.id).
 * @param planTier - New tier value.
 */
export async function setUserPlanTier(
  userId: string,
  planTier: 'FREE' | 'STARTER' | 'PRO' | 'BUSINESS',
): Promise<void> {
  const supabase = adminClient();
  const { error } = await supabase.from('users').update({ planTier }).eq('id', userId);
  if (error) throw error;
}
