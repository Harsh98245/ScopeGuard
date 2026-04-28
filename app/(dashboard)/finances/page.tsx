/**
 * @file app/(dashboard)/finances/page.tsx
 * @description Financial OS landing page. Lands fully in session 9 — gated
 *              behind PRO/BUSINESS via PlanGate at that point.
 */

import type { Metadata } from 'next';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Finances' };

export default function FinancesPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Finances</h1>
        <p className="text-sm text-muted-foreground">
          Plain-English P&amp;L, AI-categorised expenses, and quarterly tax estimates.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Connect your first integration</CardTitle>
          <CardDescription>
            Connect Stripe, PayPal, or your bank via Plaid to start unifying revenue and expenses.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Financial OS ships in session 9.</p>
        </CardContent>
      </Card>
    </div>
  );
}
