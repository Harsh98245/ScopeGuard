/**
 * @file lib/integrations/plaid.ts
 * @description Plaid integration driver. Plaid does NOT use a redirect-style
 *              OAuth flow — instead it uses Plaid Link, an in-page widget
 *              that returns a `public_token` to the client which we then
 *              exchange server-side for a long-lived `access_token`.
 *
 *              Lifecycle:
 *                1. Client calls POST /api/integrations/PLAID/link-token to
 *                   get a one-shot Link token.
 *                2. Plaid Link runs in the browser; on success it hands the
 *                   client a `public_token`.
 *                3. Client posts that public_token to
 *                   POST /api/integrations/PLAID/exchange. The route invokes
 *                   `handleCallback` here, which calls Plaid's
 *                   `/item/public_token/exchange` endpoint.
 *                4. The access_token is encrypted and persisted as an Integration row.
 *
 *              Sync uses `/transactions/sync` (cursor-based; idempotent).
 *
 *              The driver's `connectStartUrl` returns null because Plaid
 *              does not redirect the browser. The API routes special-case
 *              this driver to return the Link token instead.
 */

import 'server-only';

import type { Integration } from '@prisma/client';

import { decryptToken } from '@/lib/utils/encryption';
import { logger } from '@/lib/utils/logger';
import { signState, verifyState } from '@/lib/integrations/state';
import type {
  ConnectResult,
  ConnectStartContext,
  IntegrationDriver,
  NormalisedTransaction,
} from '@/lib/integrations/types';

// ---------------------------------------------------------------------------
// Plaid-specific input shapes
// ---------------------------------------------------------------------------

/** Link-token creation context — caller provides userId + state. */
export interface PlaidLinkTokenInput {
  userId: string;
  state: string;
}

/** Exchange input from /api/integrations/PLAID/exchange. */
export interface PlaidCallbackInput {
  publicToken: string;
  state: string;
  userId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PlaidEnv {
  clientId: string;
  secret: string;
  apiBase: string;
}

function getPlaidEnv(): PlaidEnv {
  const clientId = process.env['PLAID_CLIENT_ID'];
  const secret = process.env['PLAID_SECRET'];
  if (!clientId || !secret) throw new Error('PLAID_CLIENT_ID and PLAID_SECRET are required.');
  const env = (process.env['PLAID_ENV'] ?? 'sandbox').toLowerCase();
  const apiBase =
    env === 'production'
      ? 'https://production.plaid.com'
      : env === 'development'
        ? 'https://development.plaid.com'
        : 'https://sandbox.plaid.com';
  return { clientId, secret, apiBase };
}

async function plaidPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const env = getPlaidEnv();
  const res = await fetch(`${env.apiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, client_id: env.clientId, secret: env.secret }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Plaid ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Public helpers (used by API route, not part of the IntegrationDriver interface)
// ---------------------------------------------------------------------------

/**
 * Create a Plaid Link token bound to the user. The token is short-lived
 * (4 hours) and one-shot — surface it to the client and let Plaid Link
 * consume it.
 */
export async function createPlaidLinkToken(input: PlaidLinkTokenInput): Promise<{ linkToken: string; expiration: string }> {
  // Validate state up-front so a tampered state never reaches Plaid.
  verifyState(input.state, 'PLAID');

  const data = await plaidPost<{ link_token: string; expiration: string }>('/link/token/create', {
    user: { client_user_id: input.userId },
    client_name: 'ScopeGuard',
    products: ['transactions'],
    country_codes: ['US', 'CA', 'GB'],
    language: 'en',
  });

  return { linkToken: data.link_token, expiration: data.expiration };
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export const plaidIntegrationDriver: IntegrationDriver<PlaidCallbackInput> = {
  source: 'PLAID',
  displayName: 'Plaid (bank accounts)',
  tagline: 'Categorise expenses pulled directly from your bank or credit card.',

  async connectStartUrl(_ctx: ConnectStartContext): Promise<string | null> {
    // Plaid is in-page Link, not a redirect; the API route handles this special case.
    return null;
  },

  async handleCallback(input: PlaidCallbackInput): Promise<ConnectResult> {
    const payload = verifyState(input.state, 'PLAID');
    if (payload.userId !== input.userId) throw new Error('State user mismatch.');

    const data = await plaidPost<{ access_token: string; item_id: string }>(
      '/item/public_token/exchange',
      { public_token: input.publicToken },
    );

    return {
      accessToken: data.access_token,
      metadata: { itemId: data.item_id, env: process.env['PLAID_ENV'] ?? 'sandbox' },
    };
  },

  async syncTransactions(integration: Integration) {
    const accessToken = decryptToken(integration.accessToken);
    const meta = (integration.metadata ?? {}) as Record<string, unknown>;
    const cursor = typeof meta['cursor'] === 'string' ? (meta['cursor'] as string) : undefined;

    interface SyncResponse {
      added: Array<{
        transaction_id: string;
        amount: number; // Plaid: positive for outflows, negative for inflows
        iso_currency_code: string | null;
        unofficial_currency_code: string | null;
        name: string;
        date: string; // ISO date
      }>;
      modified: SyncResponse['added'];
      removed: Array<{ transaction_id: string }>;
      next_cursor: string;
      has_more: boolean;
    }

    const data = await plaidPost<SyncResponse>('/transactions/sync', {
      access_token: accessToken,
      ...(cursor ? { cursor } : {}),
      count: 200,
    });

    // Plaid: positive amount = money leaving the account = EXPENSE.
    //        negative amount = money arriving = INCOME.
    const transactions: NormalisedTransaction[] = [...data.added, ...data.modified].map((t) => {
      const isExpense = t.amount > 0;
      const abs = Math.abs(t.amount);
      const amount = abs.toFixed(2);
      return {
        externalId: t.transaction_id,
        type: isExpense ? 'EXPENSE' : 'INCOME',
        amount,
        currency: (t.iso_currency_code ?? t.unofficial_currency_code ?? 'USD').toUpperCase(),
        description: t.name,
        occurredAt: new Date(`${t.date}T00:00:00Z`),
      };
    });

    logger.info('integrations.plaid.synced', {
      integrationId: integration.id,
      added: data.added.length,
      modified: data.modified.length,
      removed: data.removed.length,
      hasMore: data.has_more,
    });

    return { transactions, nextCursor: data.next_cursor };
  },

  async revokeAccess(integration: Integration): Promise<void> {
    const accessToken = decryptToken(integration.accessToken);
    try {
      await plaidPost('/item/remove', { access_token: accessToken });
    } catch (e) {
      logger.warn('integrations.plaid.revoke_failed', {
        integrationId: integration.id,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  },
};

// Re-exports for the API routes.
export { signState as signPlaidState, verifyState as verifyPlaidState };
