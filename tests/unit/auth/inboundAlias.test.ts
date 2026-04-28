/**
 * @file tests/unit/auth/inboundAlias.test.ts
 * @description Sanity tests for the alias generator. These guard the
 *              uniqueness + safe-routing properties — getting the slug or
 *              suffix wrong would either leak duplicate aliases (collision)
 *              or produce malformed addresses Postmark would reject.
 */

import { describe, expect, it } from 'vitest';
import { generateInboundAlias, slugFromEmail } from '@/lib/auth/inboundAlias';

describe('slugFromEmail', () => {
  it('lowercases and kebab-cases a typical address', () => {
    expect(slugFromEmail('Jane.Doe+invoices@gmail.com')).toBe('jane-doe-invoices');
  });
  it('strips leading and trailing hyphens', () => {
    expect(slugFromEmail('---weird---@example.com')).toBe('weird');
  });
  it('falls back to "user" when no usable chars remain', () => {
    expect(slugFromEmail('!!!@example.com')).toBe('user');
  });
  it('truncates very long local parts to 24 chars', () => {
    const slug = slugFromEmail(`${'a'.repeat(50)}@x.com`);
    expect(slug.length).toBeLessThanOrEqual(24);
  });
});

describe('generateInboundAlias', () => {
  it('produces a well-formed alias with the provided domain', () => {
    const alias = generateInboundAlias('jane@gmail.com', 'inbound.scopeguard.app');
    expect(alias).toMatch(/^jane-[a-z0-9]{8}@inbound\.scopeguard\.app$/);
  });

  it('produces a different suffix on each call (no collisions in 1k samples)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(generateInboundAlias('jane@gmail.com', 'inbound.scopeguard.app'));
    }
    expect(seen.size).toBe(1000);
  });

  it('throws when no domain is configured', () => {
    const prev = process.env['INBOUND_EMAIL_DOMAIN'];
    delete process.env['INBOUND_EMAIL_DOMAIN'];
    try {
      expect(() => generateInboundAlias('jane@gmail.com')).toThrow(/INBOUND_EMAIL_DOMAIN/);
    } finally {
      if (prev !== undefined) process.env['INBOUND_EMAIL_DOMAIN'] = prev;
    }
  });
});
