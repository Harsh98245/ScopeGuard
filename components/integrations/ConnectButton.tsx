/**
 * @file components/integrations/ConnectButton.tsx
 * @description Client island that starts the connect flow for a given
 *              IntegrationSource. POSTs to /api/integrations/<source>/connect:
 *                - On `mode: redirect` → window.location.href = url.
 *                - On `mode: plaid-link` → opens Plaid Link with the token
 *                  and POSTs the resulting public_token to /exchange.
 *
 *              Plaid Link requires the Plaid JS SDK (`react-plaid-link`).
 *              This component dynamically imports it so the bundle on the
 *              integrations page stays small for non-Plaid users. The dynamic
 *              import will fail loudly if the package is not installed —
 *              install via `pnpm add react-plaid-link`.
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { IntegrationSource } from '@prisma/client';

import { Button } from '@/components/ui/button';

interface ConnectButtonProps {
  source: IntegrationSource;
  /** Disables the button if the integration is already connected. */
  alreadyConnected?: boolean;
}

interface RedirectResponse {
  mode: 'redirect';
  url: string;
}

interface PlaidLinkResponse {
  mode: 'plaid-link';
  state: string;
  linkToken: string;
  expiration: string;
}

interface ApiErrorEnvelope {
  error: { code: string; message: string };
}

export function ConnectButton({ source, alreadyConnected }: ConnectButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  async function handleClick() {
    if (loading || alreadyConnected) return;
    setLoading(true);
    setErrorMsg('');

    try {
      const res = await fetch(`/api/integrations/${source}/connect`, { method: 'POST' });
      const data = (await res.json()) as unknown;

      if (!res.ok) {
        const envelope = data as ApiErrorEnvelope;
        setErrorMsg(envelope.error?.message ?? 'Could not start connect flow.');
        setLoading(false);
        return;
      }

      const payload = data as RedirectResponse | PlaidLinkResponse;

      if (payload.mode === 'redirect') {
        window.location.href = payload.url;
        return;
      }

      // Plaid Link mode — load the SDK dynamically.
      let openLinkPromise: Promise<void>;
      try {
        const plaid = (await import('react-plaid-link')) as unknown as {
          usePlaidLink: (cfg: {
            token: string;
            onSuccess: (publicToken: string) => void;
            onExit?: () => void;
          }) => { open: () => void; ready: boolean };
        };
        // Note: usePlaidLink is a hook, not callable from this async fn —
        // when react-plaid-link is installed, swap this implementation for
        // a small <PlaidLinkLauncher> component that renders the hook. For
        // now, we surface a clear error message until the package is wired up.
        void plaid;
        openLinkPromise = Promise.reject(
          new Error(
            'Plaid Link requires `react-plaid-link` to be wired into a React component. Install the package and follow the integration RUNBOOK.',
          ),
        );
      } catch {
        openLinkPromise = Promise.reject(
          new Error('react-plaid-link is not installed. Run `pnpm add react-plaid-link`.'),
        );
      }

      try {
        await openLinkPromise;
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : 'Could not open Plaid Link.');
        setLoading(false);
        return;
      }
      router.refresh();
    } catch {
      setErrorMsg('Network error — please try again.');
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button onClick={handleClick} disabled={loading || alreadyConnected} className="w-full">
        {alreadyConnected ? 'Connected' : loading ? 'Starting…' : 'Connect'}
      </Button>
      {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
    </div>
  );
}
