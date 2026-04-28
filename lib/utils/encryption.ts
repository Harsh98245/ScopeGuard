/**
 * @file lib/utils/encryption.ts
 * @description AES-256-GCM symmetric encryption for OAuth access/refresh tokens
 *              persisted in the `integrations` table. Output format is a string
 *              of three colon-separated hex segments: `<iv>:<authTag>:<ciphertext>`.
 *              Each call uses a fresh random 12-byte IV.
 *
 * @author ScopeGuard
 * @lastModified 2026-04-27
 *
 * Rationale: GCM authenticates ciphertext, blocking bit-flip attacks on stored
 * tokens. The bundle format is intentionally hex (not base64) so DB GUI tools
 * render readable values during incident review.
 *
 * Security notes:
 *   - ENCRYPTION_KEY must be 32 bytes (64 hex chars). Generate with
 *     `openssl rand -hex 32`. Rotate quarterly per RUNBOOK rotation procedure.
 *   - Never log decrypted plaintext. Never log the key.
 *   - This module is server-only. Do not import from `app/` client components.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGO = 'aes-256-gcm' as const;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;

/**
 * Resolve the raw 32-byte key from the ENCRYPTION_KEY env var.
 *
 * @returns 32-byte Buffer ready to pass to createCipheriv.
 * @throws Error if the env var is missing or not 64 hex chars.
 */
function getKey(): Buffer {
  const hex = process.env['ENCRYPTION_KEY'];
  if (!hex) {
    throw new Error('ENCRYPTION_KEY env var is required for token encryption.');
  }
  if (hex.length !== KEY_BYTES * 2 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes).');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a UTF-8 plaintext using AES-256-GCM with a fresh random IV.
 *
 * @param plaintext - The OAuth token (or any UTF-8 string) to encrypt.
 * @returns Bundle string: `<iv-hex>:<tag-hex>:<ciphertext-hex>`.
 * @throws Error if ENCRYPTION_KEY is missing or malformed.
 *
 * @example
 *   const bundle = encryptToken('xoxb-real-secret');
 *   await prisma.integration.create({ data: { accessToken: bundle, ... } });
 */
export function encryptToken(plaintext: string): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encryptToken: plaintext must be a non-empty string.');
  }

  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/**
 * Decrypt a bundle previously produced by {@link encryptToken}.
 *
 * @param bundle - The `<iv>:<tag>:<ciphertext>` hex bundle from the database.
 * @returns The original UTF-8 plaintext.
 * @throws Error on malformed input or authentication failure (tampered ciphertext).
 *
 * @example
 *   const token = decryptToken(integration.accessToken);
 *   await stripe.charges.list({}, { stripeAccount: token });
 */
export function decryptToken(bundle: string): string {
  if (typeof bundle !== 'string' || bundle.length === 0) {
    throw new Error('decryptToken: bundle must be a non-empty string.');
  }

  const parts = bundle.split(':');
  if (parts.length !== 3) {
    throw new Error('decryptToken: malformed bundle (expected iv:tag:ciphertext).');
  }
  const [ivHex, tagHex, ctHex] = parts as [string, string, string];

  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ct = Buffer.from(ctHex, 'hex');

  if (iv.length !== IV_BYTES) throw new Error('decryptToken: bad IV length.');
  if (tag.length !== TAG_BYTES) throw new Error('decryptToken: bad auth tag length.');

  const key = getKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);

  try {
    const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
    return plaintext.toString('utf8');
  } catch (_err) {
    // Do not surface the underlying error to callers — it can leak whether
    // the key or the ciphertext was at fault.
    throw new Error('decryptToken: authentication failed (tampered ciphertext or wrong key).');
  }
}

/**
 * Constant-time comparison helper. Use when verifying webhook signatures or
 * comparing user-submitted tokens against a stored value.
 *
 * @param a - First value.
 * @param b - Second value.
 * @returns true if the byte-strings are equal AND of equal length.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
