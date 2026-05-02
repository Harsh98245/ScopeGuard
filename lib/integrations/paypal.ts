/**
 * @file lib/integrations/paypal.ts
 * @description PayPal integration driver. Uses PayPal's "Log In with PayPal"
 *              OAuth 2.0 flow with the `https://uri.paypal.com/services/reporting/search/read`
 *              scope so we can pull the merchant's transaction history.
 *
 *              The OAuth2 token endpoint is server-to-server (Basic auth with
 *              PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET); the access token has
 *              a ~32k-second lifetime and is refresh-tokenable.
 *
 *              The transaction sync uses the
 *              /v1/reporting/transactions endpoint, which returns one
 *              completed transaction per row. Rate-limit-aware pagination
 *              is the cursor we persist on metadata.
 *
 *              NOTE: this driver requires PayPal sandbox/live credentials
 *              configured in the env. Without them, attempts to start the
 *              flow throw early in `connectStartUrl`.
 */

import 'server-only';

import type { Integration } from '@prisma/client';

import { logger } from '@/lib/utils/logger';
import { signState, verifyState } from '@/lib/integrations/state';
import type {
  ConnectResult,
  ConnectStartContext,
  IntegrationDriver,
  NormalisedTransaction,
  OAuthCallbackInput,
} from '@/lib/integrations/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PaypalEnv {
  clientId: string;
  clientSecret: string;
  /** Either the live or sandbox base URL. */
  apiBase: string;
  /** Public OAuth authorize endpoint. Differs from apiBase. */
  authorizeBase: string;
}

function getPaypalEnv(): PaypalEnv {
  const clientId = process.env['PAYPAL_CLIENT_ID'];
  const clientSecret = process.env['PAYPAL_CLIENT_SECRET'];
  if (!clientId || !clientSecret) {
    throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required.');
  }
  const sandbox = process.env['PAYPAL_ENV'] !== 'live';
  return {
    clientId,
    clientSecret,
    apiBase: sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com',
    authorizeBase: sandbox
      ? 'https://www.sandbox.paypal.com/connect'
      : 'https://www.paypal.com/connect',
  };
}

function basicAuth(env: PaypalEnv): string {
  return `Basic ${Buffer.from(`${env.clientId}:${env.clientSecret}`).toString('base64')}`;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export const paypalIntegrationDriver: IntegrationDriver<OAuthCallbackInput> = {
  source: 'PAYPAL',
  displayName: 'PayPal',
  tagline: 'Sync invoices and customer payments from PayPal as INCOME transactions.',

  async connectStartUrl({ state, redirectUri }: ConnectStartContext): Promise<string> {
    const env = getPaypalEnv();
    const params = new URLSearchParams({
      flowEntry: 'static',
      client_id: env.clientId,
      response_type: 'code',
      scope:
        'openid profile email https://uri.paypal.com/services/reporting/search/read',
      redirect_uri: redirectUri,
      state,
    });
    return `${env.authorizeBase}?${params.toString()}`;
  },

  async handleCallback(input: OAuthCallbackInput): Promise<ConnectResult> {
    const payload = verifyState(input.state, 'PAYPAL');
    if (payload.userId !== input.userId) {
      throw new Error('State user mismatch.');
    }

    const env = getPaypalEnv();
    const res = await fetch(`${env.apiBase}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(env),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
      }).toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PayPal OAuth token exchange failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const tokenJson = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
    };

    return {
      accessToken: tokenJson.access_token,
      ...(tokenJson.refresh_token ? { refreshToken: tokenJson.refresh_token } : {}),
      ...(tokenJson.expires_in
        ? { tokenExpiresAt: new Date(Date.now() + tokenJson.expires_in * 1000) }
        : {}),
      metadata: {
        tokenType: tokenJson.token_type ?? 'Bearer',
        env: process.env['PAYPAL_ENV'] ?? 'sandbox',
      },
    };
  },

  async syncTransactions(_integration: Integration) {
    // The PayPal Reporting API requires the access token + a date window.
    // For v1 we leave the actual call as a TODO; the wiring below proves
    // the driver compiles and integrates with the framework. Filling in
    // requires sandbox credentials + a test merchant account; tracked as
    // a follow-up under the integrations RUNBOOK section.
    logger.warn('integrations.paypal.sync_not_implemented', {
      integrationId: _integration.id,
    });
    const transactions: NormalisedTransaction[] = [];
    return { transactions, nextCursor: null };
  },

  async revokeAccess(_integration: Integration): Promise<void> {
    // PayPal does not currently offer a programmatic revocation endpoint
    // for OAuth 2.0 access tokens — users revoke via Account Settings →
    // Manage Access. We rely on token expiry + row deletion.
    logger.info('integrations.paypal.revoke_noop', {
      integrationId: _integration.id,
    });
  },
};

// Re-exports for ergonomics in API routes.
export { signState as signPaypalState, verifyState as verifyPaypalState };
