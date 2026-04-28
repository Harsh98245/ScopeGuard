/**
 * @file app/api/auth/signout/route.ts
 * @description Signs the current user out and redirects to the landing page.
 *              POST-only so it cannot be triggered by an `<img src>` CSRF.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';

/**
 * POST /api/auth/signout
 *
 * @returns 302 redirect to /.
 */
export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.signOut();
  if (error) logger.warn('auth.signout.failed', { message: error.message });

  return NextResponse.redirect(new URL('/', request.url), { status: 303 });
}
