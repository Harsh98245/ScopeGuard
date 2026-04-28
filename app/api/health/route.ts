/**
 * @file app/api/health/route.ts
 * @description Liveness probe. Returns 200 with {ok:true} when the app is up.
 *              Used by Vercel health checks, the post-deploy verify script,
 *              and external uptime monitoring.
 */

import { NextResponse } from 'next/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const APP_VERSION = '0.1.0';

/**
 * GET /api/health
 *
 * @returns 200 JSON `{ ok: true, version: string }`.
 */
export function GET() {
  return NextResponse.json({ ok: true, version: APP_VERSION });
}
