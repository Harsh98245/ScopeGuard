/**
 * @file app/(dashboard)/projects/[id]/scope-check/page.tsx
 * @description Manual scope-check page. Lets the user paste an email body
 *              and run a scope check against the project's latest parsed
 *              contract without waiting for a real inbound email.
 *
 *              The server component checks auth and loads the project; the
 *              interactive form is a client island (`ScopeCheckForm`) that
 *              POSTs to /api/scope/check and renders the verdict inline.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ScopeCheckForm } from '@/components/scope/ScopeCheckForm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireCurrentUser } from '@/lib/auth/getCurrentUser';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Manual scope check' };

interface ScopeCheckPageProps {
  params: { id: string };
}

export default async function ScopeCheckPage({ params }: ScopeCheckPageProps) {
  const user = await requireCurrentUser(`/projects/${params.id}/scope-check`);

  const project = await prisma.project.findFirst({
    where: { id: params.id, userId: user.id },
    select: {
      id: true,
      name: true,
      clientName: true,
      clientEmail: true,
      contracts: {
        where: { parsedAt: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, fileName: true, parsedAt: true },
      },
    },
  });

  if (!project) notFound();

  const parsedContract = project.contracts[0] ?? null;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link
          href={`/projects/${project.id}`}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← {project.name}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Manual scope check</h1>
        <p className="text-sm text-muted-foreground">
          Test a client email against the{' '}
          <span className="font-medium">{project.name}</span> contract without
          waiting for a forwarded email.
        </p>
      </header>

      {/* Contract status warning */}
      {!parsedContract && (
        <Card className="border-[hsl(var(--verdict-ambiguous))] border">
          <CardHeader>
            <CardTitle className="text-base">No parsed contract</CardTitle>
            <CardDescription>
              The scope check will run but the verdict will likely be{' '}
              <strong>AMBIGUOUS</strong> because there is no parsed contract to
              compare against.{' '}
              <Link
                href={`/projects/${project.id}/contracts`}
                className="underline underline-offset-2"
              >
                Upload and parse a contract first
              </Link>{' '}
              for accurate verdicts.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {parsedContract && (
        <p className="text-xs text-muted-foreground">
          Checking against:{' '}
          <span className="font-medium">{parsedContract.fileName}</span>
          {' · '}
          parsed {parsedContract.parsedAt?.toLocaleDateString()}
        </p>
      )}

      <ScopeCheckForm project={project} />

      {/* Help card */}
      <Card className="bg-muted/40">
        <CardContent className="pt-4 text-sm text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">How this works</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Paste the client&apos;s email body — the AI reads it against your contract clauses.</li>
            <li>Subject and From fields are optional but improve verdict accuracy.</li>
            <li>The result is saved and appears in your Inbox feed.</li>
            <li>For production use, have clients email your personal alias directly.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
