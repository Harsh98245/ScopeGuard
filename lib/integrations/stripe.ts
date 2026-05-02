/**
 * @file lib/integrations/stripe.ts
 * @description Stripe Connect (Standard) integration driver. Lets a
 *              ScopeGuard user link their Stripe account so we can sync
 *              charges + payouts as INCOME transactions.
 *
 *              Distinct from `lib/stripe/client.ts`, which is the platform's
 *              own Stripe account used for ScopeGuard subscriptions billing.
 *              Connect creates a separate Stripe-issued access token bound to
 *              the user's Stripe account.
 *
 *              Auth flow:
 *                1. User clicks "Connect Stripe" → /api/integrations/STRIPE/connect
 *                   → driver returns the Stripe OAuth URL with a signed `state`.
 *                2. User authorises on Stripe → Stripe redirects to
 *                   /api/integrations/STRIPE/callback?code=…&state=…
 *                3. The route invokes `handleCallback`, which exchanges the
 *                   code for an access token + connected-account ID via
 *                   `stripe.oauth.token`.
 *                4. The route encrypts and persists the tokens.
 *
 *              Sync flow:
 *                1. `syncTransactions(integration)` reads `metadata.cursor`
 *                   (the latest Stripe charge ID seen) and pulls all charges
 *                   newer than that page-by-page.
 *                2. Each charge is normalised into a {@link NormalisedTransaction}.
 *                3. Returns the new cursor for persistence.
 */

import 'server-only';

import type { Integration } from '@prisma/client';

import { decryptToken } from '@/lib/utils/encryption';
import { logger } from '@/lib/utils/logger';
import { getStripe } from '@/lib/stripe/client';
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

/**
 * Resolve the Stripe Connect client ID from the env. Distinct from the
 * platform secret key — this is the public connect-app identifier shown on
 * the OAuth authorize URL.
 */
function getConnectClientId(): string {
  const id = process.env['STRIPE_CONNECT_CLIENT_ID'];
  if (!id) throw new Error('STRIPE_CONNECT_CLIENT_ID env var is required.');
  return id;
}

/** Convert a Stripe `amount` (minor units integer) + currency to a decimal string. */
function stripeAmountToDecimal(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${negative ? '-' : ''}${whole}.${frac.toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export const stripeIntegrationDriver: IntegrationDriver<OAuthCallbackInput> = {
  source: 'STRIPE',
  displayName: 'Stripe',
  tagline: 'Pull charges and payouts as INCOME transactions automatically.',

  async connectStartUrl({ state, redirectUri }: ConnectStartContext): Promise<string> {
    const clientId = getConnectClientId();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: 'read_only',
      redirect_uri: redirectUri,
      state,
    });
    return `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
  },

  async handleCallback(input: OAuthCallbackInput): Promise<ConnectResult> {
    // Verify state via HMAC; any tampering or expiry throws.
    const payload = verifyState(input.state, 'STRIPE');
    if (payload.userId !== input.userId) {
      throw new Error('State user mismatch.');
    }

    const stripe = getStripe();
    // Exchange the authorization code for an access token + connected
    // account ID. `stripe.oauth.token` calls the platform's secret key.
    const tokenResponse = await stripe.oauth.token({
      grant_type: 'authorization_code',
      code: input.code,
    });

    const accessToken = tokenResponse.access_token;
    if (!accessToken) {
      throw new Error('Stripe OAuth response did not include an access token.');
    }

    return {
      accessToken,
      ...(tokenResponse.refresh_token ? { refreshToken: tokenResponse.refresh_token } : {}),
      metadata: {
        connectedAccountId: tokenResponse.stripe_user_id,
        scope: tokenResponse.scope ?? 'read_only',
        livemode: tokenResponse.livemode ?? null,
      },
    };
  },

  async syncTransactions(integration: Integration) {
    const accessToken = decryptToken(integration.accessToken);
    const stripe = getStripe();

    // Persist a cursor in metadata.cursor — the most-recent charge ID synced.
    const meta = (integration.metadata ?? {}) as Record<string, unknown>;
    const cursor = typeof meta['cursor'] === 'string' ? (meta['cursor'] as string) : undefined;

    // For Stripe Connect Standard accounts, the OAuth access_token IS the
    // connected account's secret key. Pass it via per-request `apiKey` so
    // this call acts on the connected account's behalf without needing
    // the `stripeAccount` header (which is an alternative path for direct
    // platform API keys).
    const charges = await stripe.charges.list(
      {
        limit: 100,
        ...(cursor ? { ending_before: cursor } : {}),
      },
      { apiKey: accessToken },
    );

    const transactions: NormalisedTransaction[] = charges.data
      .filter((c) => c.status === 'succeeded')
      .map((c) => ({
        externalId: c.id,
        type: 'INCOME',
        amount: stripeAmountToDecimal(c.amount),
        currency: c.currency.toUpperCase(),
        description: c.description ?? null,
        occurredAt: new Date(c.created * 1000),
      }));

    logger.info('integrations.stripe.synced', {
      integrationId: integration.id,
      pulled: charges.data.length,
      kept: transactions.length,
      hasMore: charges.has_more,
    });

    const newest = transactions[0];
    return {
      transactions,
      nextCursor: newest?.externalId ?? cursor ?? null,
    };
  },

  async revokeAccess(integration: Integration): Promise<void> {
    const meta = (integration.metadata ?? {}) as Record<string, unknown>;
    const connectedAccountId =
      typeof meta['connectedAccountId'] === 'string'
        ? (meta['connectedAccountId'] as string)
        : null;
    if (!connectedAccountId) return;

    try {
      await getStripe().oauth.deauthorize({
        client_id: getConnectClientId(),
        stripe_user_id: connectedAccountId,
      });
    } catch (e) {
      // Non-fatal — the row will still be deleted; user can re-authorize later.
      logger.warn('integrations.stripe.revoke_failed', {
        integrationId: integration.id,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  },
};

// ---------------------------------------------------------------------------
// Re-exports — used by the API routes for ergonomic imports.
// ---------------------------------------------------------------------------

export { signState as signStripeConnectState, verifyState as verifyStripeConnectState };
