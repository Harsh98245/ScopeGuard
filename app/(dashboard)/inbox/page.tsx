/**
 * @file app/(dashboard)/inbox/page.tsx
 * @description Inbox feed — every scope-check verdict across all of the
 *              current user's projects, newest first.
 *
 *              Initial render is a server component that runs the Prisma
 *              query under the user's session. A zero-height client island
 *              (`InboxRealtimeFeed`) subscribes to Supabase Realtime so
 *              verdicts appear without a page reload when a new inbound email
 *              is processed.
 *
 *              Up to 50 verdicts are shown without pagination; a note below
 *              the list links to the project for any project-specific drill-down.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { InboxRealtimeFeed } from '@/components/scope/InboxRealtimeFeed';
import { VerdictCard } from '@/components/scope/VerdictCard';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { requireCurrentUser } from '@/lib/auth/getCurrentUser';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Inbox' };

/** Maximum verdicts shown on the inbox feed without pagination. */
const INBOX_LIMIT = 50;

export default async function InboxPage() {
  const user = await requireCurrentUser('/inbox');

  const checks = await prisma.scopeCheck.findMany({
    where: { project: { userId: user.id } },
    include: {
      project: { select: { id: true, name: true, clientName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: INBOX_LIMIT,
  });

  return (
    <div className="space-y-6">
      {/* Page header */}
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Every forwarded client email and the verdict ScopeGuard returned.
          New verdicts appear automatically.
        </p>
      </header>

      {checks.length === 0 ? (
        <EmptyInbox />
      ) : (
        <>
          <div className="space-y-4">
            {checks.map((check) => (
              <VerdictCard key={check.id} check={check} showProject />
            ))}
          </div>

          {checks.length === INBOX_LIMIT && (
            <p className="text-center text-xs text-muted-foreground">
              Showing the {INBOX_LIMIT} most recent verdicts. Older checks are
              accessible per-project under{' '}
              <Link href="/projects" className="underline underline-offset-2">
                Projects
              </Link>
              .
            </p>
          )}
        </>
      )}

      {/* Realtime subscription — triggers router.refresh() on new inserts */}
      <InboxRealtimeFeed />
    </div>
  );
}

function EmptyInbox() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>No verdicts yet</CardTitle>
        <CardDescription>
          Once you upload a contract and forward your first client email to your
          inbound alias, the verdict and a drafted reply will appear here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>To get your first verdict:</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>
            <Link href="/projects/new" className="underline underline-offset-2">
              Create a project
            </Link>{' '}
            and upload a contract.
          </li>
          <li>
            Copy your personal inbound alias from the{' '}
            <Link href="/projects" className="underline underline-offset-2">
              Projects
            </Link>{' '}
            page.
          </li>
          <li>
            Forward a client email to that alias. The verdict appears here
            within seconds.
          </li>
          <li>
            Or{' '}
            <Link href="/projects" className="underline underline-offset-2">
              open a project
            </Link>{' '}
            and use the manual scope-check form to test without sending an email.
          </li>
        </ol>
      </CardContent>
    </Card>
  );
}
