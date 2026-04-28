/**
 * @file app/(dashboard)/settings/page.tsx
 * @description Settings landing — surfaces the few things we already know
 *              about the user (email, alias, timezone, plan tier) in
 *              read-only form. Editable controls land alongside the
 *              billing + integrations pages in sessions 8/10.
 */

import type { Metadata } from 'next';

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
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Read-only for now — editing lands in session 8.</CardDescription>
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
