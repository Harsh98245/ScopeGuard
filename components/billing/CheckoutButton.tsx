/**
 * @file components/billing/CheckoutButton.tsx
 * @description Client island that POSTs to /api/billing/checkout and
 *              forwards the user to the returned Stripe Checkout URL.
 *              Disabled state is used by PricingTable to show the user's
 *              current plan as non-actionable.
 */

'use client';

import { useState } from 'react';
import type { PlanTier } from '@prisma/client';

import { Button } from '@/components/ui/button';

interface CheckoutButtonProps {
  /** Tier to upgrade/downgrade to. */
  tier: Exclude<PlanTier, 'FREE'>;
  /** When true, the button shows "Current plan" and is non-actionable. */
  disabled?: boolean;
}

interface CheckoutApiResponse {
  url: string;
}

interface ApiErrorEnvelope {
  error: { code: string; message: string };
}

export function CheckoutButton({ tier, disabled }: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  async function handleClick() {
    if (disabled || loading) return;
    setLoading(true);
    setErrorMsg('');

    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      });

      const data = (await res.json()) as unknown;

      if (!res.ok) {
        const envelope = data as ApiErrorEnvelope;
        setErrorMsg(envelope.error?.message ?? 'Could not start checkout.');
        setLoading(false);
        return;
      }

      const { url } = data as CheckoutApiResponse;
      window.location.href = url;
    } catch {
      setErrorMsg('Network error — please try again.');
      setLoading(false);
    }
  }

  if (disabled) {
    return (
      <Button variant="outline" className="w-full" disabled>
        Current plan
      </Button>
    );
  }

  return (
    <div className="space-y-1">
      <Button onClick={handleClick} disabled={loading} className="w-full">
        {loading ? 'Redirecting…' : 'Upgrade'}
      </Button>
      {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
    </div>
  );
}
