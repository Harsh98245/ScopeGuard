/**
 * @file components/integrations/IntegrationCard.tsx
 * @description Server component for a single integration card. Shows the
 *              provider name + tagline. If the user has the integration
 *              connected, renders sync + disconnect actions and the last
 *              sync timestamp. Otherwise renders the Connect button.
 */

import type { Integration, IntegrationSource } from '@prisma/client';

import { ConnectButton } from '@/components/integrations/ConnectButton';
import { IntegrationActions } from '@/components/integrations/IntegrationActions';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { DriverDescriptor } from '@/lib/integrations/registry';

interface IntegrationCardProps {
  descriptor: DriverDescriptor;
  /** The user's current row for this source, if they've connected it. */
  integration: Pick<
    Integration,
    'id' | 'isActive' | 'lastSyncedAt' | 'createdAt' | 'tokenExpiresAt'
  > | null;
}

function formatRelative(d: Date | null): string {
  if (!d) return 'never';
  const ms = Date.now() - d.getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function IntegrationCard({ descriptor, integration }: IntegrationCardProps) {
  const connected = integration !== null && integration.isActive;
  return (
    <Card className={connected ? 'ring-1 ring-primary/30' : ''}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg">{descriptor.displayName}</CardTitle>
          {connected ? (
            <Badge variant="success">Connected</Badge>
          ) : (
            <Badge variant="outline">Not connected</Badge>
          )}
        </div>
        <CardDescription>{descriptor.tagline}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {connected ? (
          <>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p>Last sync: {formatRelative(integration!.lastSyncedAt)}</p>
              <p>Connected on: {integration!.createdAt.toISOString().slice(0, 10)}</p>
            </div>
            <IntegrationActions source={descriptor.source as IntegrationSource} />
          </>
        ) : (
          <ConnectButton source={descriptor.source as IntegrationSource} />
        )}
      </CardContent>
    </Card>
  );
}
