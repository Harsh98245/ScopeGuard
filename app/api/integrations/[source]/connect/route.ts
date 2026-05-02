/**
 * @file app/api/integrations/[source]/connect/route.ts
 * @description Start the connect flow for a given IntegrationSource. For
 *              OAuth-style providers (STRIPE, PAYPAL) returns the authorize
 *              URL; for Plaid returns a one-shot Link token.
 *
 *              POST is intentional even for read-style operations because
 *              starting the flow has side-effects (it issues a signed CSRF
 *              state token).
 */

import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { getDriver } from '@/lib/integrations/registry';
import { signState } from '@/lib/integrations/state';
import { createPlaidLinkToken } from '@/lib/integrations/plaid';
import { getPlanLimits } from '@/lib/stripe/plans';
import { logger } from '@/lib/utils/logger';
import type { IntegrationSource } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_SOURCES: ReadonlySet<string> = new Set([
  'STRIPE',
  'PAYPAL',
  'PLAID',
]);

interface ApiError {
  error: { code: string; message: string };
}
function err(code: string, message: string, status: number) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

function resolveBaseUrl(): string {
  const explicit = process.env['NEXT_PUBLIC_APP_URL'];
  if (explicit) return explicit;
  const vercel = process.env['VERCEL_URL'];
  if (vercel) return `https://${vercel}`;
  return 'http://localhost:3000';
}

interface RouteContext {
  params: { source: string };
}

export async function POST(_req: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return err('UNAUTHENTICATED', 'Sign in required.', 401);
  if (!getPlanLimits(user.planTier).hasFinancialOS) {
    return err('PLAN_LIMIT_EXCEEDED', 'Integrations require the Pro plan.', 402);
  }

  const sourceRaw = params.source.toUpperCase();
  if (!VALID_SOURCES.has(sourceRaw)) {
    return err('NOT_FOUND', 'Unknown integration source.', 404);
  }
  const source = sourceRaw as IntegrationSource;
  const driver = getDriver(source);
  if (!driver) return err('NOT_FOUND', 'No driver for this source.', 404);

  const state = signState(user.id, source);
  const redirectUri = `${resolveBaseUrl()}/api/integrations/${source}/callback`;

  // Plaid uses Link tokens, not redirect URLs.
  if (source === 'PLAID') {
    try {
      const linkToken = await createPlaidLinkToken({ userId: user.id, state });
      logger.info('integrations.plaid.link_token_issued', { userId: user.id });
      return NextResponse.json({ mode: 'plaid-link', state, ...linkToken });
    } catch (e) {
      logger.error('integrations.plaid.link_token_failed', {
        userId: user.id,
        message: e instanceof Error ? e.message : String(e),
      });
      return err('PROVIDER_ERROR', 'Could not start Plaid Link.', 502);
    }
  }

  // OAuth providers — return the authorize URL.
  try {
    const url = await driver.connectStartUrl({ state, redirectUri, userId: user.id });
    if (!url) return err('UNSUPPORTED', 'This provider has no redirect-style connect.', 500);
    logger.info('integrations.connect.url_issued', { userId: user.id, source });
    return NextResponse.json({ mode: 'redirect', url });
  } catch (e) {
    logger.error('integrations.connect.failed', {
      userId: user.id,
      source,
      message: e instanceof Error ? e.message : String(e),
    });
    return err('PROVIDER_ERROR', 'Could not start the connect flow.', 502);
  }
}
