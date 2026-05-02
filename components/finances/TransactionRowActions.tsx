/**
 * @file components/finances/TransactionRowActions.tsx
 * @description Client island per row: a Delete button that DELETEs to
 *              /api/finances/transactions/:id and refreshes the table.
 *              Inline category/deductible edit is left to a future iteration —
 *              for v1, the user can delete + re-create, or wait for the AI
 *              categoriser to land an updated category.
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';

interface TransactionRowActionsProps {
  transactionId: string;
}

export function TransactionRowActions({ transactionId }: TransactionRowActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function handleDelete() {
    if (pending) return;
    if (!confirm('Delete this transaction? This cannot be undone.')) return;

    setPending(true);
    setError('');
    try {
      const res = await fetch(`/api/finances/transactions/${transactionId}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        setError('Could not delete transaction.');
        setPending(false);
        return;
      }
      router.refresh();
    } catch {
      setError('Network error.');
      setPending(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={handleDelete}
        disabled={pending}
        className="h-7 px-2 text-xs"
      >
        {pending ? 'Deleting…' : 'Delete'}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
