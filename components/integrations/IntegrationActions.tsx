/**
 * @file components/integrations/IntegrationActions.tsx
 * @description Client island giving users the two operations on a connected
 *              integration: trigger a manual sync (POST), or disconnect
 *              (DELETE). Both refresh the parent page on success so the
 *              "Last synced" copy and connection status stay current.
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { IntegrationSource } from '@prisma/client';

import { Button } from '@/components/ui/button';

interface IntegrationActionsProps {
  source: IntegrationSource;
}

export function IntegrationActions({ source }: IntegrationActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<'sync' | 'disconnect' | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSync() {
    if (pending !== null) return;
    setPending('sync');
    setErrorMsg('');
    try {
      const res = await fetch(`/api/integrations/${source}`, { method: 'POST' });
      if (!res.ok && res.status !== 202) {
        setErrorMsg('Could not start sync.');
        setPending(null);
        return;
      }
      router.refresh();
      setPending(null);
    } catch {
      setErrorMsg('Network error.');
      setPending(null);
    }
  }

  async function handleDisconnect() {
    if (pending !== null) return;
    if (!confirm(`Disconnect ${source}? You can reconnect later.`)) return;
    setPending('disconnect');
    setErrorMsg('');
    try {
      const res = await fetch(`/api/integrations/${source}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        setErrorMsg('Could not disconnect.');
        setPending(null);
        return;
      }
      router.refresh();
    } catch {
      setErrorMsg('Network error.');
      setPending(null);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Button
          onClick={handleSync}
          disabled={pending !== null}
          variant="outline"
          size="sm"
        >
          {pending === 'sync' ? 'Syncing…' : 'Sync now'}
        </Button>
        <Button
          onClick={handleDisconnect}
          disabled={pending !== null}
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
        >
          {pending === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
        </Button>
      </div>
      {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
    </div>
  );
}
