/**
 * @file app/(dashboard)/settings/page.tsx
 * @description Settings landing — surfaces the few things we already know
 *              about the user (email, alias, timezone, plan tier) in
 *              read-only form, plus an entry point to the Billing page.
 *              Editable account controls land alongside integrations in
 *              session 10.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { requireCurrentUser } from '@/lib/auth/getCurrentUser';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const user = await requireCurrentUser('/settings');

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Account and product preferences.</p>
      </header>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1">
            <CardTitle>Account</CardTitle>
            <CardDescription>Read-only for now — editable controls land in session 10.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" value={user.email} />
          <Field label="Plan" value={user.planTier} />
          <Field label="Timezone" value={user.timezone} />
          <Field label="Jurisdiction" value={user.jurisdiction} />
          <Field
            label="Inbound alias"
            value={user.inboundEmailAlias}
            mono
            description="Forward client emails here for automatic scope checks."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1">
            <CardTitle>Billing & plans</CardTitle>
            <CardDescription>
              Switch plans, update payment methods, and view invoices.
            </CardDescription>
          </div>
          <Button asChild variant="outline">
            <Link href="/settings/billing">Manage billing →</Link>
          </Button>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1">
            <CardTitle>Integrations</CardTitle>
            <CardDescription>
              Connect Stripe, PayPal, and bank accounts via Plaid for automated transaction sync.
            </CardDescription>
          </div>
          <Button asChild variant="outline">
            <Link href="/settings/integrations">Manage integrations →</Link>
          </Button>
        </CardHeader>
      </Card>
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  mono?: boolean;
  description?: string;
}

function Field({ label, value, mono, description }: FieldProps) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={mono ? 'font-mono text-sm' : 'text-sm'}>{value}</p>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}
