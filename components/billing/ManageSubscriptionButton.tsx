/**
 * @file components/billing/ManageSubscriptionButton.tsx
 * @description Client island that POSTs to /api/billing/portal and forwards
 *              the user to the returned Stripe Customer Portal URL. The
 *              portal lets users update payment methods, view invoices, and
 *              cancel subscriptions without us having to build that UI.
 */

'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';

interface PortalApiResponse {
  url: string;
}

interface ApiErrorEnvelope {
  error: { code: string; message: string };
}

export function ManageSubscriptionButton() {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    setErrorMsg('');

    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const data = (await res.json()) as unknown;

      if (!res.ok) {
        const envelope = data as ApiErrorEnvelope;
        setErrorMsg(envelope.error?.message ?? 'Could not open billing portal.');
        setLoading(false);
        return;
      }

      const { url } = data as PortalApiResponse;
      window.location.href = url;
    } catch {
      setErrorMsg('Network error — please try again.');
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button onClick={handleClick} disabled={loading} variant="outline">
        {loading ? 'Opening…' : 'Manage subscription'}
      </Button>
      {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
    </div>
  );
}
