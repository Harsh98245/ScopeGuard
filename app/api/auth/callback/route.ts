/**
 * @file app/api/auth/callback/route.ts
 * @description Handles both flows that land here:
 *                1. Email-link confirmation (Supabase sends the user a link
 *                   after signup; the link points here with `?code=...`).
 *                2. OAuth (Google) callback — same `?code=...` shape.
 *
 *              On success we exchange the code for a session, ensure the
 *              public `users` row exists, then redirect the user onward.
 *
 *              Failures redirect to /login with a `?error=...` querystring
 *              so the login page can surface a helpful message.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { ensureUserProfile } from '@/lib/auth/ensureUserProfile';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs'; // node:crypto used in the alias generator

/**
 * GET /api/auth/callback?code=<otp-or-oauth-code>&next=<redirect-path>
 *
 * @returns 302 redirect — to `next` (or /projects) on success,
 *          /login?error=... on failure.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const errorDescription = url.searchParams.get('error_description');
  const nextPath = sanitizeNextPath(url.searchParams.get('next'));
  const origin = url.origin;

  // Provider returned an error before reaching us.
  if (errorDescription) {
    logger.warn('auth.callback.provider_error', { errorDescription });
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(errorDescription)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session || !data.user) {
    logger.warn('auth.callback.exchange_failed', { message: error?.message });
    return NextResponse.redirect(`${origin}/login?error=invalid_code`);
  }

  // Create the public user row on first login. Idempotent.
  try {
    await ensureUserProfile({
      id: data.user.id,
      email: data.user.email!,
    });
  } catch (err) {
    logger.error('auth.callback.profile_failed', {
      userId: data.user.id,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.redirect(`${origin}/login?error=profile_provisioning_failed`);
  }

  return NextResponse.redirect(`${origin}${nextPath}`);
}

/**
 * Whitelist the `next` parameter to in-app paths only. Prevents an open-
 * redirect attack where an attacker emails a victim a confirmation link
 * with `?next=https://evil.example/`.
 */
function sanitizeNextPath(next: string | null): string {
  if (!next) return '/projects';
  if (!next.startsWith('/') || next.startsWith('//')) return '/projects';
  return next;
}
