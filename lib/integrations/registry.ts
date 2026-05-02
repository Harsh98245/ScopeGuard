/**
 * @file lib/integrations/registry.ts
 * @description Source → driver dispatcher. Adding a new integration means:
 *                1. Implement the {@link IntegrationDriver} contract under
 *                   `lib/integrations/<source>.ts`.
 *                2. Register it in `DRIVERS` below.
 *                3. Add a row to `.env.example` for the credentials.
 *                4. Update `docs/RUNBOOK.md` with the provider setup.
 *
 *              Never add a `case` to a `switch` in the API route — always
 *              go through this registry so the cross-cutting code remains
 *              provider-agnostic.
 */

import type { IntegrationSource } from '@prisma/client';

import { paypalIntegrationDriver } from '@/lib/integrations/paypal';
import { plaidIntegrationDriver } from '@/lib/integrations/plaid';
import { stripeIntegrationDriver } from '@/lib/integrations/stripe';
import type { IntegrationDriver } from '@/lib/integrations/types';

// ---------------------------------------------------------------------------
// Registration table
// ---------------------------------------------------------------------------

/**
 * Drivers that ScopeGuard knows how to talk to. The `IntegrationSource` enum
 * has more values (GUMROAD, SHOPIFY, ETSY, UPWORK, WISE) — those are reserved
 * for future drivers; calling `getDriver` with one of them returns null.
 */
const DRIVERS: Partial<Record<IntegrationSource, IntegrationDriver<unknown>>> = {
  STRIPE: stripeIntegrationDriver as unknown as IntegrationDriver<unknown>,
  PAYPAL: paypalIntegrationDriver as unknown as IntegrationDriver<unknown>,
  PLAID: plaidIntegrationDriver as unknown as IntegrationDriver<unknown>,
};

/**
 * Resolve the driver for a given source. Returns null for sources that
 * have no driver implementation yet.
 */
export function getDriver(source: IntegrationSource): IntegrationDriver<unknown> | null {
  return DRIVERS[source] ?? null;
}

/** Sources we currently expose connect buttons for in the UI. */
export const AVAILABLE_SOURCES = Object.keys(DRIVERS) as IntegrationSource[];

/**
 * Lightweight presentational metadata used by the integrations card grid
 * without forcing the UI to import the full driver module on every render.
 */
export interface DriverDescriptor {
  source: IntegrationSource;
  displayName: string;
  tagline: string;
  /** Whether this driver requires the in-page Plaid-Link-style flow. */
  inPageConnect: boolean;
}

export function describeDrivers(): DriverDescriptor[] {
  return AVAILABLE_SOURCES.map((source) => {
    const driver = DRIVERS[source]!;
    return {
      source,
      displayName: driver.displayName,
      tagline: driver.tagline,
      inPageConnect: source === 'PLAID',
    };
  });
}
