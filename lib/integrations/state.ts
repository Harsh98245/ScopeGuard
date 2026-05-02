/**
 * @file lib/integrations/state.ts
 * @description CSRF state-token helpers shared by every OAuth-style
 *              integration driver. The state token is HMAC-signed with the
 *              app's `ENCRYPTION_KEY` so callbacks can verify it without
 *              storing per-user state in a session.
 *
 *              Format: `<base64url-payload>.<base64url-hmac>` where the
 *              payload is `{ userId, source, nonce, exp }` JSON.
 *
 *              Tokens expire after 10 minutes. If the user dawdles in the
 *              provider's consent screen and the token expires, the callback
 *              returns 400 and the user is asked to re-start the flow.
 */

import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

import type { IntegrationSource } from '@prisma/client';

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface StatePayload {
  userId: string;
  source: IntegrationSource;
  nonce: string;
  /** Expiry time as UNIX millis. */
  exp: number;
}

function getKey(): Buffer {
  const hex = process.env['ENCRYPTION_KEY'];
  if (!hex || hex.length < 32) {
    throw new Error('ENCRYPTION_KEY (32+ hex chars) is required for OAuth state.');
  }
  return Buffer.from(hex, 'hex');
}

function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64url(s: string): Buffer {
  const padding = (4 - (s.length % 4)) % 4;
  return Buffer.from(s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat(padding), 'base64');
}

/**
 * Build a signed state token for an OAuth flow.
 *
 * @param userId - Caller's User.id.
 * @param source - The IntegrationSource being connected.
 * @returns Opaque token to embed in the OAuth `state` parameter.
 */
export function signState(userId: string, source: IntegrationSource): string {
  const payload: StatePayload = {
    userId,
    source,
    nonce: randomBytes(16).toString('hex'),
    exp: Date.now() + STATE_TTL_MS,
  };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64url(Buffer.from(payloadJson, 'utf8'));
  const sig = base64url(createHmac('sha256', getKey()).update(payloadB64).digest());
  return `${payloadB64}.${sig}`;
}

/**
 * Verify a state token and return its payload.
 *
 * @param token  - Token from the OAuth callback's `state` parameter.
 * @param source - Expected IntegrationSource (must match payload).
 * @returns The decoded payload.
 * @throws Error on signature mismatch, expired token, source mismatch, or
 *         malformed input.
 */
export function verifyState(token: string, source: IntegrationSource): StatePayload {
  const parts = token.split('.');
  if (parts.length !== 2) throw new Error('Malformed state token.');
  const [payloadB64, sigB64] = parts as [string, string];

  const expected = createHmac('sha256', getKey()).update(payloadB64).digest();
  const provided = fromBase64url(sigB64);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new Error('Invalid state signature.');
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(fromBase64url(payloadB64).toString('utf8')) as StatePayload;
  } catch {
    throw new Error('Malformed state payload.');
  }

  if (payload.exp < Date.now()) throw new Error('State token expired.');
  if (payload.source !== source) {
    throw new Error(`State source mismatch (expected=${source}, got=${payload.source})`);
  }
  return payload;
}
