/**
 * @file tests/setup.ts
 * @description Vitest setup hook. Loads jest-dom matchers and provides a
 *              deterministic test ENCRYPTION_KEY so encryption.test.ts runs
 *              without needing a real .env.
 */

import '@testing-library/jest-dom/vitest';

// 32-byte fixed key — DO NOT use this value in any non-test environment.
process.env['ENCRYPTION_KEY'] =
  process.env['ENCRYPTION_KEY'] ??
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
