/**
 * @file components/finances/AddTransactionForm.tsx
 * @description Client form for adding a manual transaction. POSTs to
 *              `/api/finances/transactions` and redirects to the transactions
 *              list on success.
 *
 *              The category dropdown is OPTIONAL — leaving it blank on an
 *              EXPENSE triggers the AI categoriser via the `transaction/created`
 *              Inngest event and the row will show "Categorising…" until the
 *              function lands the result.
 */

'use client';

import { type FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EXPENSE_CATEGORIES, categoryLabel } from '@/lib/finances/categories';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AddTransactionFormProps {
  /** Default currency to pre-fill (mirrors the user's jurisdiction). */
  defaultCurrency: string;
}

interface ApiErrorEnvelope {
  error: { code: string; message: string };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AddTransactionForm({ defaultCurrency }: AddTransactionFormProps) {
  const router = useRouter();
  const [type, setType] = useState<'INCOME' | 'EXPENSE'>('EXPENSE');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;

    const fd = new FormData(e.currentTarget);
    const amount = ((fd.get('amount') as string) ?? '').trim();
    const currency = ((fd.get('currency') as string) ?? '').trim().toUpperCase();
    const description = ((fd.get('description') as string) ?? '').trim();
    const category = (fd.get('category') as string) ?? '';
    const taxDeductible = fd.get('taxDeductible') === 'on';
    const occurredAtRaw = ((fd.get('occurredAt') as string) ?? '').trim();

    setPending(true);
    setError('');

    try {
      const res = await fetch('/api/finances/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          amount,
          currency,
          description: description || undefined,
          category: category || undefined,
          taxDeductible: type === 'EXPENSE' ? taxDeductible : undefined,
          occurredAt: occurredAtRaw ? new Date(occurredAtRaw).toISOString() : undefined,
        }),
      });

      const data = (await res.json()) as unknown;

      if (!res.ok) {
        const envelope = data as ApiErrorEnvelope;
        setError(envelope.error?.message ?? 'Could not save transaction.');
        setPending(false);
        return;
      }

      router.push('/finances/transactions');
      router.refresh();
    } catch {
      setError('Network error — please try again.');
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="type">Type</Label>
          <select
            id="type"
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as 'INCOME' | 'EXPENSE')}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            disabled={pending}
          >
            <option value="EXPENSE">Expense</option>
            <option value="INCOME">Income</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="occurredAt">Date</Label>
          <Input
            id="occurredAt"
            name="occurredAt"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
            disabled={pending}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="amount">
            Amount <span className="text-destructive">*</span>
          </Label>
          <Input
            id="amount"
            name="amount"
            type="text"
            inputMode="decimal"
            placeholder="42.00"
            required
            pattern="^\d+(\.\d{1,2})?$"
            disabled={pending}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="currency">
            Currency <span className="text-destructive">*</span>
          </Label>
          <Input
            id="currency"
            name="currency"
            type="text"
            defaultValue={defaultCurrency}
            placeholder="USD"
            required
            maxLength={3}
            pattern="^[A-Za-z]{3}$"
            disabled={pending}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          name="description"
          placeholder={
            type === 'INCOME' ? 'Invoice #1042 — ACME Corp' : 'GitHub Pro subscription'
          }
          maxLength={500}
          disabled={pending}
        />
      </div>

      {type === 'EXPENSE' && (
        <>
          <div className="space-y-1">
            <Label htmlFor="category">Category (optional — AI will fill in)</Label>
            <select
              id="category"
              name="category"
              defaultValue=""
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              disabled={pending}
            >
              <option value="">— Auto-categorise —</option>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Leave blank and Claude will categorise based on the description.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="taxDeductible"
              className="h-4 w-4 rounded border-input"
              disabled={pending}
            />
            Tax-deductible business expense
          </label>
        </>
      )}

      {error && (
        <Alert variant="destructive">
          <p className="text-sm">{error}</p>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Add transaction'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
