/**
 * @file lib/integrations/types.ts
 * @description Shared types for the integration framework. Every provider
 *              (Stripe Connect, PayPal, Plaid, …) implements an
 *              {@link IntegrationDriver} so the API routes, Inngest sync
 *              function, and UI can stay provider-agnostic.
 *
 *              The driver is intentionally stateless — it receives the
 *              `Integration` row when it needs persisted credentials, and
 *              it never reads from `prisma` directly. That keeps the driver
 *              testable in isolation (no database required).
 */

import type { Integration, IntegrationSource } from '@prisma/client';

// ---------------------------------------------------------------------------
// Shared payloads
// ---------------------------------------------------------------------------

/**
 * Result of an OAuth-style "connect" flow. The driver returns this from
 * `handleCallback`; the API route persists it as an Integration row.
 *
 * `accessToken` and `refreshToken` are stored ENCRYPTED via
 * `lib/utils/encryption.ts`. The driver returns them in plaintext; the
 * caller (API route) encrypts before write.
 */
export interface ConnectResult {
  /** Plaintext access token. Caller encrypts before persistence. */
  accessToken: string;
  /** Optional plaintext refresh token. */
  refreshToken?: string;
  /** Optional token expiry (set when the provider issues short-lived tokens). */
  tokenExpiresAt?: Date;
  /** Provider-specific metadata (Stripe Connect account ID, Plaid item ID, etc.). */
  metadata?: Record<string, unknown>;
}

/**
 * One row in the synced-transaction stream. Drivers normalise their
 * provider-native payload into this shape so the cross-provider sync
 * function can persist them with a single `prisma.transaction.upsert`.
 *
 * The `(source, externalId)` pair must be globally unique within a provider,
 * matching the Prisma schema's unique constraint.
 */
export interface NormalisedTransaction {
  /** Provider's stable transaction ID. */
  externalId: string;
  type: 'INCOME' | 'EXPENSE';
  /** Decimal string — major units. */
  amount: string;
  currency: string;
  description: string | null;
  occurredAt: Date;
}

/** Outcome of one sync run. Logged + surfaced in the integrations UI. */
export interface SyncResult {
  /** New transactions written this run. */
  inserted: number;
  /** Existing transactions whose mutable fields were updated. */
  updated: number;
  /** Skipped because (source, externalId) already existed AND no fields changed. */
  unchanged: number;
  /** Cursor / pagination token to persist on the integration row, if any. */
  nextCursor?: string | null;
}

// ---------------------------------------------------------------------------
// Driver interface
// ---------------------------------------------------------------------------

/**
 * The contract every integration provider implements. The framework drives
 * the lifecycle (connect → sync → disconnect); each driver translates the
 * common steps into the provider's specific API calls.
 *
 * @typeParam ConnectInput - Optional, provider-specific payload from the
 *                           "start connect" route (e.g. Plaid Link sends back
 *                           a public token rather than an OAuth code).
 */
export interface IntegrationDriver<ConnectInput = OAuthCallbackInput> {
  /** Provider identifier — must match a `IntegrationSource` enum value. */
  readonly source: IntegrationSource;
  /** Human-readable name for UI labels. */
  readonly displayName: string;
  /** One-line tagline used in the integrations card. */
  readonly tagline: string;

  /**
   * Build the URL the user's browser is redirected to in order to start the
   * connect flow. For OAuth providers this is the authorize endpoint; for
   * Plaid this is unused (Plaid Link is in-page). Must be idempotent and
   * return null when the driver uses a different connect mechanism.
   *
   * @param ctx - Caller context (state token, return URL, etc.).
   */
  connectStartUrl(ctx: ConnectStartContext): Promise<string | null>;

  /**
   * Exchange the provider's callback payload for credentials. Must verify
   * the `state` token if applicable, then return the {@link ConnectResult}
   * for persistence.
   */
  handleCallback(input: ConnectInput): Promise<ConnectResult>;

  /**
   * Pull the latest transactions from the provider for the given
   * Integration row. The `cursor` field on the integration metadata is the
   * provider-specific pagination key.
   */
  syncTransactions(integration: Integration): Promise<{
    transactions: NormalisedTransaction[];
    nextCursor?: string | null;
  }>;

  /**
   * Best-effort revocation of the access token at the provider. Failures
   * are logged but do not block disconnection — the row is removed
   * regardless so the user is never stuck with a half-connected integration.
   */
  revokeAccess?(integration: Integration): Promise<void>;
}

/** Context handed to `connectStartUrl`. */
export interface ConnectStartContext {
  /** CSRF state token to include in the OAuth URL; the callback verifies it. */
  state: string;
  /** Absolute URL the provider should redirect to after the user approves. */
  redirectUri: string;
  /** Opaque per-user identifier so the callback can re-resolve the user. */
  userId: string;
}

/** Default callback input shape for OAuth providers (code + state). */
export interface OAuthCallbackInput {
  code: string;
  state: string;
  /** Caller's expected state token, used for the constant-time comparison. */
  expectedState: string;
  /** The redirect URI used in `connectStartUrl`. Some providers require it again. */
  redirectUri: string;
  userId: string;
}
