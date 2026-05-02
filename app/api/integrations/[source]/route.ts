/**
 * @file app/api/integrations/[source]/route.ts
 * @description Operate on the user's existing integration for a given source.
 *                - DELETE — disconnect: best-effort revoke at the provider,
 *                  then delete the row. Always 204 even if revoke fails so
 *                  the user is never stuck with a half-connected integration.
 *                - POST   — queue a manual sync (fires the Inngest event).
 *
 *              Addressing by source (not row UUID) is unambiguous because the
 *              Prisma schema enforces @@unique([userId, source]) — at most
 *              one integration per (user, source) pair.
 */

import { NextResponse } from 'next/server';

import { inngest } from '@/inngest/client';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { getDriver } from '@/lib/integrations/registry';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/utils/logger';
import type { IntegrationSource } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_SOURCES: ReadonlySet<string> = new Set(['STRIPE', 'PAYPAL', 'PLAID']);

interface ApiError {
  error: { code: string; message: string };
}
function err(code: string, message: string, status: number) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

interface RouteContext {
  params: { source: string };
}

function resolveSource(raw: string): IntegrationSource | null {
  const upper = raw.toUpperCase();
  return VALID_SOURCES.has(upper) ? (upper as IntegrationSource) : null;
}

// ---------------------------------------------------------------------------
// DELETE — disconnect
// ---------------------------------------------------------------------------

export async function DELETE(_req: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return err('UNAUTHENTICATED', 'Sign in required.', 401);

  const source = resolveSource(params.source);
  if (!source) return err('NOT_FOUND', 'Unknown integration source.', 404);

  const integration = await prisma.integration.findFirst({
    where: { userId: user.id, source },
  });
  if (!integration) return err('NOT_FOUND', 'Integration not found.', 404);

  const driver = getDriver(integration.source);
  if (driver?.revokeAccess) {
    try {
      await driver.revokeAccess(integration);
    } catch (e) {
      logger.warn('integrations.revoke_failed', {
        integrationId: integration.id,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  await prisma.integration.delete({ where: { id: integration.id } });

  logger.info('integrations.disconnected', {
    userId: user.id,
    integrationId: integration.id,
    source: integration.source,
  });

  return new NextResponse(null, { status: 204 });
}

// ---------------------------------------------------------------------------
// POST — manual sync trigger
// ---------------------------------------------------------------------------

export async function POST(_req: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return err('UNAUTHENTICATED', 'Sign in required.', 401);

  const source = resolveSource(params.source);
  if (!source) return err('NOT_FOUND', 'Unknown integration source.', 404);

  const integration = await prisma.integration.findFirst({
    where: { userId: user.id, source, isActive: true },
    select: { id: true, userId: true },
  });
  if (!integration) return err('NOT_FOUND', 'Active integration not found.', 404);

  await inngest.send({
    name: 'integration/connected',
    data: { userId: integration.userId, integrationId: integration.id },
  });

  logger.info('integrations.manual_sync.queued', {
    userId: user.id,
    integrationId: integration.id,
    source,
  });

  return NextResponse.json({ ok: true, status: 'queued' }, { status: 202 });
}
