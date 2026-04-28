/**
 * @file lib/auth/ensureUserProfile.ts
 * @description Idempotently creates the application-level User row that
 *              mirrors a Supabase auth user. Called from the OAuth/email
 *              callback route on first login and again on every dashboard
 *              load as a safety net (the upsert is cheap).
 *
 *              The Supabase auth.users row is the source of truth for
 *              authentication; the public `users` row is what the app
 *              reads — it carries plan tier, inbound alias, timezone,
 *              and tax jurisdiction. Splitting them this way is what
 *              the spec asks for and lets us add app-specific columns
 *              without migrating Supabase internals.
 */

import 'server-only';

import type { User } from '@prisma/client';

import { generateInboundAlias } from '@/lib/auth/inboundAlias';
import { logger } from '@/lib/utils/logger';
import { prisma } from '@/lib/prisma';

/**
 * Inputs taken from the Supabase auth user. We intentionally do NOT accept
 * a raw `SupabaseUser` here — the dependency would force this server-only
 * module into client bundles via type imports.
 */
export interface EnsureUserProfileInput {
  /** Supabase auth UUID — becomes our `User.id`. */
  id: string;
  /** Verified email from Supabase. Required. */
  email: string;
  /**
   * Optional IANA timezone hint from the browser. When supplied (signup
   * form sends `Intl.DateTimeFormat().resolvedOptions().timeZone`), it
   * overrides the default 'America/Toronto'.
   */
  timezone?: string;
}

/**
 * Create-if-missing the public `users` row.
 *
 * Behaviour:
 *   - If a row already exists for this id, returns it untouched.
 *   - Otherwise generates a fresh inbound alias + creates the row.
 *
 * The alias generator is deterministic-by-format but uses random bytes,
 * so a rare retry collision falls through to the unique constraint and
 * surfaces as an error the caller can retry.
 *
 * @param input - Auth user data (id + email + optional timezone).
 * @returns The existing or newly-created User row.
 *
 * @example
 *   const user = await ensureUserProfile({
 *     id: authUser.id,
 *     email: authUser.email!,
 *     timezone: 'America/Los_Angeles',
 *   });
 */
export async function ensureUserProfile(input: EnsureUserProfileInput): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { id: input.id } });
  if (existing) return existing;

  const inboundEmailAlias = generateInboundAlias(input.email);

  try {
    const created = await prisma.user.create({
      data: {
        id: input.id,
        email: input.email,
        inboundEmailAlias,
        ...(input.timezone ? { timezone: input.timezone } : {}),
      },
    });
    logger.info('user.profile.created', { userId: created.id });
    return created;
  } catch (err) {
    // Race: a concurrent request created the row between our findUnique and
    // create. Re-fetch and return.
    logger.warn('user.profile.create.race', { userId: input.id });
    const after = await prisma.user.findUnique({ where: { id: input.id } });
    if (after) return after;
    throw err;
  }
}
