/**
 * @file app/(dashboard)/inbox/page.tsx
 * @description Forwarded-emails + verdicts surface. Empty placeholder until
 *              the Postmark + Inngest pipeline lands in session 6.
 */

import type { Metadata } from 'next';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Inbox' };

export default function InboxPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Every forwarded client email and the verdict ScopeGuard returned.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>No verdicts yet</CardTitle>
          <CardDescription>
            Once you upload a contract and forward your first client email, the verdict and a
            drafted reply will appear here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Inbox feed lands in session 6.</p>
        </CardContent>
      </Card>
    </div>
  );
}
