/**
 * @file app/(auth)/actions.ts
 * @description Server actions for login, signup, and Google OAuth init.
 *              Used by the LoginForm and SignupForm client components.
 *
 *              Each action validates the FormData with Zod, calls Supabase,
 *              and either redirects on success or returns a structured
 *              { error } object the form can render. Never throw across the
 *              server-action boundary — useFormState wants a serialisable
 *              return value.
 */

'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { authLimiter, checkLimit } from '@/lib/utils/rateLimit';
import { logger } from '@/lib/utils/logger';
import { EmailSchema } from '@/lib/utils/validation';

/** Standard return shape — `error` set when the form should re-render. */
export interface AuthActionResult {
  error?: string;
}

const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(8, 'Password must be at least 8 characters.').max(128),
  next: z.string().optional(),
});

const SignupSchema = LoginSchema.extend({
  // Browser-supplied IANA tz so the user's clock formatting is right from
  // their first dashboard load.
  timezone: z.string().min(1).max(64).optional(),
});

/**
 * Resolve the caller's IP for rate-limiting. Vercel sets x-forwarded-for;
 * fall back to the connection address when running behind another proxy.
 */
function callerIp(): string {
  const h = headers();
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    h.get('x-real-ip') ??
    h.get('cf-connecting-ip') ??
    'unknown'
  );
}

/**
 * Sign in with email + password. On success redirects to `next` (validated
 * to be an in-app path) or /projects.
 */
export async function loginAction(_prev: AuthActionResult, formData: FormData): Promise<AuthActionResult> {
  const limited = await checkLimit(authLimiter, callerIp());
  if (limited) {
    return { error: `Too many attempts. Try again in ${limited.retryAfter}s.` };
  }

  const parsed = LoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    logger.info('auth.login.failed', { email: parsed.data.email, code: error.code });
    return { error: 'Invalid email or password.' };
  }

  redirect(safePath(parsed.data.next));
}

/**
 * Create a new account. Supabase sends a confirmation email; the user is
 * NOT signed in yet — they must click the link, which routes through
 * /api/auth/callback.
 */
export async function signupAction(_prev: AuthActionResult, formData: FormData): Promise<AuthActionResult> {
  const limited = await checkLimit(authLimiter, callerIp());
  if (limited) {
    return { error: `Too many attempts. Try again in ${limited.retryAfter}s.` };
  }

  const parsed = SignupSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    timezone: formData.get('timezone') ?? undefined,
    next: formData.get('next') ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const supabase = createSupabaseServerClient();
  const origin = headers().get('origin') ?? process.env['NEXT_PUBLIC_APP_URL'] ?? '';
  const redirectTo = `${origin}/api/auth/callback?next=${encodeURIComponent(safePath(parsed.data.next))}`;

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: redirectTo,
      ...(parsed.data.timezone ? { data: { timezone: parsed.data.timezone } } : {}),
    },
  });

  if (error) {
    logger.info('auth.signup.failed', { email: parsed.data.email, code: error.code });
    // Supabase intentionally returns the same message for already-registered
    // emails to avoid account enumeration. Mirror that here.
    return { error: humanizeSignupError(error.message) };
  }

  // If email confirmations are disabled in Supabase config the user is
  // signed in immediately — redirect.
  if (data.session) redirect(safePath(parsed.data.next));

  return { error: undefined };
}

/**
 * Begin a Google OAuth handshake. Returns the provider URL for the form
 * to navigate to.
 */
export async function googleSignInAction(): Promise<AuthActionResult> {
  const supabase = createSupabaseServerClient();
  const origin = headers().get('origin') ?? process.env['NEXT_PUBLIC_APP_URL'] ?? '';
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${origin}/api/auth/callback` },
  });
  if (error || !data?.url) {
    logger.warn('auth.oauth.google.failed', { message: error?.message });
    return { error: 'Could not start Google sign-in. Try email instead.' };
  }
  redirect(data.url);
}

/** Same open-redirect guard as the callback route. */
function safePath(next: string | null | undefined): string {
  if (!next) return '/projects';
  if (!next.startsWith('/') || next.startsWith('//')) return '/projects';
  return next;
}

function humanizeSignupError(message: string): string {
  if (/registered/i.test(message)) {
    return 'If that email is available, a confirmation link is on its way.';
  }
  if (/password/i.test(message)) {
    return 'Password is too weak — please use at least 8 characters.';
  }
  return 'Could not create your account. Please try again.';
}
