/**
 * @file lib/prisma.ts
 * @description Prisma client singleton. Hot-reload in dev would otherwise
 *              create a new client on every change and exhaust the connection
 *              pool. We attach the client to globalThis to survive HMR.
 *
 *              Server-only. Never import from client components.
 */

import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__prisma ??
  new PrismaClient({
    log:
      process.env['NODE_ENV'] === 'production'
        ? ['error']
        : ['warn', 'error'],
  });

if (process.env['NODE_ENV'] !== 'production') {
  globalThis.__prisma = prisma;
}
