/**
 * @file tests/unit/integrations/state.test.ts
 * @description Tests for the OAuth CSRF state-token helpers. Critical
 *              security-sensitive code: signature must be HMAC-verified
 *              with constant-time compare; expired tokens must reject;
 *              source mismatch must reject (prevents replay across providers).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  // Deterministic 32-byte hex key for the suite.
  process.env['ENCRYPTION_KEY'] = 'a'.repeat(64);
});

afterEach(() => {
  delete process.env['ENCRYPTION_KEY'];
  vi.useRealTimers();
});

import { signState, verifyState } from '@/lib/integrations/state';

describe('signState / verifyState', () => {
  it('signs and verifies a STRIPE state token round-trip', () => {
    const token = signState('user-1', 'STRIPE');
    const payload = verifyState(token, 'STRIPE');
    expect(payload.userId).toBe('user-1');
    expect(payload.source).toBe('STRIPE');
    expect(payload.nonce).toMatch(/^[a-f0-9]{32}$/);
  });

  it('produces a unique token per call (no nonce collisions)', () => {
    const a = signState('user-1', 'STRIPE');
    const b = signState('user-1', 'STRIPE');
    expect(a).not.toBe(b);
  });

  it('rejects a token whose signature has been tampered with', () => {
    const token = signState('user-1', 'STRIPE');
    const [payload, sig] = token.split('.') as [string, string];
    const tampered = `${payload}.${sig.slice(0, -1)}A`;
    expect(() => verifyState(tampered, 'STRIPE')).toThrow(/signature/i);
  });

  it('rejects a token whose payload has been tampered with', () => {
    const token = signState('user-1', 'STRIPE');
    const [payload, sig] = token.split('.') as [string, string];
    // Flip the first character of the base64 payload.
    const tampered = `${payload.slice(0, -1)}Z.${sig}`;
    expect(() => verifyState(tampered, 'STRIPE')).toThrow();
  });

  it('rejects when the source does not match', () => {
    const token = signState('user-1', 'STRIPE');
    expect(() => verifyState(token, 'PAYPAL')).toThrow(/source mismatch/i);
  });

  it('rejects an expired token', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const token = signState('user-1', 'STRIPE');

    // Fast-forward 11 minutes past expiry.
    vi.setSystemTime(new Date('2026-01-01T00:11:00Z'));
    expect(() => verifyState(token, 'STRIPE')).toThrow(/expired/i);
  });

  it('rejects a malformed (non-two-part) token', () => {
    expect(() => verifyState('garbage', 'STRIPE')).toThrow(/Malformed/);
    expect(() => verifyState('a.b.c', 'STRIPE')).toThrow(/Malformed/);
  });

  it('throws when ENCRYPTION_KEY is missing', () => {
    delete process.env['ENCRYPTION_KEY'];
    expect(() => signState('user-1', 'STRIPE')).toThrow(/ENCRYPTION_KEY/);
  });
});
