/**
 * @file app/(dashboard)/settings/integrations/page.tsx
 * @description Integrations management page — connect/disconnect/sync
 *              third-party financial providers. Cards are rendered for every
 *              registered driver via `describeDrivers()` so adding a new
 *              integration only requires registering it in the lib/integrations
 *              registry.
 *
 *              Surfaces success/error banners parsed from the OAuth callback
 *              redirect query string (`?connected=<source>` or `?error=<code>`).
 *
 *              Gated behind PRO via the same plan check used for the Financial OS.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { IntegrationCard } from '@/components/integrations/IntegrationCard';
import { PlanGate } from '@/components/billing/PlanGate';
import { Alert } from '@/components/ui/alert';
import { requireCurrentUser } from '@/lib/auth/getCurrentUser';
import { describeDrivers } from '@/lib/integrations/registry';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Integrations' };

interface IntegrationsPageProps {
  searchParams: { connected?: string; error?: string };
}

export default async function IntegrationsPage({ searchParams }: IntegrationsPageProps) {
  const user = await requireCurrentUser('/settings/integrations');

  if (user.planTier === 'FREE' || user.planTier === 'STARTER') {
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <Link
            href="/settings"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Settings
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        </header>
        <PlanGate
          requires="PRO"
          currentTier={user.planTier}
          featureName="Integrations"
          featureDescription="Auto-sync revenue and expenses from Stripe, PayPal, and your bank via Plaid."
        >
          <></>
        </PlanGate>
      </div>
    );
  }

  const [drivers, existing] = await Promise.all([
    Promise.resolve(describeDrivers()),
    prisma.integration.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        source: true,
        isActive: true,
        lastSyncedAt: true,
        tokenExpiresAt: true,
        createdAt: true,
      },
    }),
  ]);

  const bySource = new Map(existing.map((i) => [i.source, i]));

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link
          href="/settings"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Settings
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Connect third-party providers to auto-sync transactions into your Financial OS.
        </p>
      </header>

      {searchParams.connected && (
        <Alert>
          <p className="text-sm font-medium">
            {searchParams.connected} connected
          </p>
          <p className="text-xs text-muted-foreground">
            A backfill sync is running now — your transactions will appear in the
            Finances dashboard within a few minutes.
          </p>
        </Alert>
      )}

      {searchParams.error && (
        <Alert variant="destructive">
          <p className="text-sm font-medium">Connect failed</p>
          <p className="text-xs">
            Error: <span className="font-mono">{searchParams.error}</span>. Try again, or check
            the integration RUNBOOK if the failure persists.
          </p>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {drivers.map((driver) => (
          <IntegrationCard
            key={driver.source}
            descriptor={driver}
            integration={bySource.get(driver.source) ?? null}
          />
        ))}
      </div>
    </div>
  );
}
