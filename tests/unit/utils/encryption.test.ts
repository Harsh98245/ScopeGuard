/**
 * @file tests/unit/utils/encryption.test.ts
 * @description Round-trip and tamper-resistance tests for the AES-256-GCM
 *              token wrapper. These tests intentionally do not mock crypto.
 */

import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken, safeEqual } from '@/lib/utils/encryption';

describe('encryption', () => {
  it('round-trips a typical OAuth token', () => {
    const plaintext = 'sk-test-abcdef1234567890';
    const cipher = encryptToken(plaintext);
    expect(cipher.split(':')).toHaveLength(3);
    expect(decryptToken(cipher)).toBe(plaintext);
  });

  it('produces distinct ciphertexts for the same plaintext (random IV)', () => {
    const a = encryptToken('the same string');
    const b = encryptToken('the same string');
    expect(a).not.toBe(b);
  });

  it('rejects a tampered ciphertext', () => {
    const cipher = encryptToken('hello world');
    // Flip one hex char in the ciphertext segment.
    const parts = cipher.split(':');
    const ct = parts[2]!;
    const tampered = `${parts[0]}:${parts[1]}:${ct.slice(0, -1)}${ct.endsWith('0') ? '1' : '0'}`;
    expect(() => decryptToken(tampered)).toThrow(/authentication failed/i);
  });

  it('rejects a malformed bundle', () => {
    expect(() => decryptToken('nope')).toThrow();
    expect(() => decryptToken('a:b')).toThrow();
  });

  it('rejects empty plaintext', () => {
    expect(() => encryptToken('')).toThrow();
  });
});

describe('safeEqual', () => {
  it('returns true for equal strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
  });
  it('returns false for unequal strings of equal length', () => {
    expect(safeEqual('abc', 'abd')).toBe(false);
  });
  it('returns false for strings of different lengths', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
