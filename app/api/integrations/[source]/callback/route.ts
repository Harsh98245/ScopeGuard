/**
 * @file app/api/integrations/[source]/callback/route.ts
 * @description OAuth callback for redirect-style providers (Stripe Connect,
 *              PayPal). Reads `code` + `state` from the query string, hands
 *              them to the driver's `handleCallback`, encrypts the returned
 *              tokens, and persists an Integration row.
 *
 *              On success: 302 → /settings/integrations?connected=<source>.
 *              On failure: 302 → /settings/integrations?error=<code>.
 *              We never leak provider error bodies into URLs — the user sees
 *              the high-level code and the structured log holds the detail.
 */

import { NextResponse } from 'next/server';

import { inngest } from '@/inngest/client';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { getDriver } from '@/lib/integrations/registry';
import { prisma } from '@/lib/prisma';
import { encryptToken } from '@/lib/utils/encryption';
import { checkIpLimit, oauthCallbackLimiter } from '@/lib/utils/ipRateLimit';
import { logger } from '@/lib/utils/logger';
import type { IntegrationSource } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_SOURCES: ReadonlySet<string> = new Set(['STRIPE', 'PAYPAL']);

function resolveBaseUrl(): string {
  const explicit = process.env['NEXT_PUBLIC_APP_URL'];
  if (explicit) return explicit;
  const vercel = process.env['VERCEL_URL'];
  if (vercel) return `https://${vercel}`;
  return 'http://localhost:3000';
}

function redirect(toPath: string) {
  return NextResponse.redirect(`${resolveBaseUrl()}${toPath}`);
}

interface RouteContext {
  params: { source: string };
}

export async function GET(req: Request, { params }: RouteContext) {
  // IP-based rate limit. OAuth code-replay attempts and scanner traffic
  // both hit this endpoint without a valid session — bounce them early.
  const limited = await checkIpLimit(oauthCallbackLimiter, req);
  if (limited) {
    logger.warn('integrations.callback.rate_limited', { ip: limited.ip, source: params.source });
    return redirect('/settings/integrations?error=rate_limited');
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const providerError = url.searchParams.get('error');

  const sourceRaw = params.source.toUpperCase();
  if (!VALID_SOURCES.has(sourceRaw)) {
    return redirect('/settings/integrations?error=unknown_source');
  }
  const source = sourceRaw as IntegrationSource;

  if (providerError) {
    logger.warn('integrations.oauth.provider_error', { source, providerError });
    return redirect(`/settings/integrations?error=${encodeURIComponent(providerError)}`);
  }
  if (!code || !state) {
    return redirect('/settings/integrations?error=missing_code_or_state');
  }

  const user = await getCurrentUser();
  if (!user) return redirect('/login?next=/settings/integrations');

  const driver = getDriver(source);
  if (!driver) return redirect('/settings/integrations?error=no_driver');

  const redirectUri = `${resolveBaseUrl()}/api/integrations/${source}/callback`;

  try {
    const result = await driver.handleCallback({
      code,
      state,
      expectedState: state,
      redirectUri,
      userId: user.id,
    });

    // Encrypt before persistence — accessToken column is the encrypted bundle.
    const accessToken = encryptToken(result.accessToken);
    const refreshToken = result.refreshToken ? encryptToken(result.refreshToken) : null;

    // Upsert by (userId, source) — the Prisma schema enforces a single
    // active integration per (user, source) pair.
    const integration = await prisma.integration.upsert({
      where: { userId_source: { userId: user.id, source } },
      create: {
        userId: user.id,
        source,
        accessToken,
        refreshToken,
        tokenExpiresAt: result.tokenExpiresAt ?? null,
        isActive: true,
        metadata: (result.metadata ?? {}) as Record<string, unknown>,
      },
      update: {
        accessToken,
        refreshToken,
        tokenExpiresAt: result.tokenExpiresAt ?? null,
        isActive: true,
        metadata: (result.metadata ?? {}) as Record<string, unknown>,
      },
    });

    // Trigger an immediate backfill sync.
    await inngest.send({
      name: 'integration/connected',
      data: { userId: user.id, integrationId: integration.id },
    });

    logger.info('integrations.connected', {
      userId: user.id,
      source,
      integrationId: integration.id,
    });

    return redirect(`/settings/integrations?connected=${source}`);
  } catch (e) {
    logger.error('integrations.callback.failed', {
      userId: user.id,
      source,
      message: e instanceof Error ? e.message : String(e),
    });
    return redirect('/settings/integrations?error=callback_failed');
  }
}
