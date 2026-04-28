/**
 * @file middleware.ts
 * @description Next.js middleware for auth + session refresh. Refreshes the
 *              Supabase session cookie on every request so SSR pages always
 *              see fresh auth state. Authenticated dashboard routes redirect
 *              to /login when no session is present.
 *
 *              In session 1 (scaffold) this only runs the refresh logic; the
 *              redirect rule activates once the auth pages land in session 3.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

const PROTECTED_PREFIXES = ['/projects', '/inbox', '/finances', '/settings'];
const AUTH_ONLY_PATHS = ['/login', '/signup'];

export async function middleware(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: '', ...options });
        },
      },
    },
  );

  // Refresh session if expired — required for Server Components.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
  const isAuthOnly = AUTH_ONLY_PATHS.includes(path);

  // Redirect unauthenticated users away from protected routes.
  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  // Redirect signed-in users away from /login and /signup.
  if (isAuthOnly && user) {
    const url = request.nextUrl.clone();
    url.pathname = '/projects';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

/**
 * Match every route except Next internals, static assets, the public landing
 * page, and webhook routes (which authenticate themselves via signatures).
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/webhooks/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
