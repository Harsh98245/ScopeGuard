/**
 * @file app/(dashboard)/projects/[id]/page.tsx
 * @description Project detail page. Shows the project header, the latest
 *              contract's parse status, and a compact scope-log table of the
 *              20 most recent verdicts. A "Run manual check" link navigates
 *              to the scope-check form at /projects/[id]/scope-check.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ScopeLogTable } from '@/components/scope/ScopeLogTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { requireCurrentUser } from '@/lib/auth/getCurrentUser';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Project' };

interface ProjectPageProps {
  params: { id: string };
}

export default async function ProjectDetailPage({ params }: ProjectPageProps) {
  const user = await requireCurrentUser(`/projects/${params.id}`);

  const project = await prisma.project.findFirst({
    where: { id: params.id, userId: user.id },
    include: {
      contracts: {
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
    },
  });
  if (!project) notFound();

  const latest = project.contracts[0];
  const parseStatus = !latest
    ? 'no-contract'
    : latest.parsedAt
      ? 'parsed'
      : 'pending';

  // Fetch the 20 most recent scope checks for the log table.
  const scopeChecks = await prisma.scopeCheck.findMany({
    where: { projectId: project.id },
    select: {
      id: true,
      verdict: true,
      confidence: true,
      emailSubject: true,
      emailFromAddress: true,
      userAction: true,
      createdAt: true,
      projectId: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link
          href="/projects"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← All projects
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
            <p className="text-sm text-muted-foreground">
              {project.clientName}
              {project.clientEmail ? ` · ${project.clientEmail}` : ''}
              {' · '}
              {project.hourlyRate
                ? `${project.currency} ${project.hourlyRate.toString()}/hr`
                : 'No hourly rate set'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={`/projects/${project.id}/scope-check`}>Run manual check</Link>
            </Button>
            <Button asChild>
              <Link href={`/projects/${project.id}/contracts`}>
                {latest ? 'Manage contracts' : 'Upload contract'}
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Active contract card */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-lg">Active contract</CardTitle>
            <CardDescription>
              {latest
                ? `Latest upload: ${latest.fileName}`
                : 'No contract uploaded yet — scope checks will be ambiguous until you upload one.'}
            </CardDescription>
          </div>
          <ParseBadge status={parseStatus} />
        </CardHeader>
        {latest ? (
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-3">
              <Button asChild variant="outline" size="sm">
                <Link href={`/projects/${project.id}/contracts`}>View parsed clauses</Link>
              </Button>
              <span className="text-xs text-muted-foreground">
                Uploaded {latest.createdAt.toISOString().slice(0, 10)}
              </span>
            </div>
          </CardContent>
        ) : null}
      </Card>

      {/* Scope log */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-lg">Recent scope checks</CardTitle>
            <CardDescription>
              Verdicts on emails forwarded to your inbound alias, newest first.
            </CardDescription>
          </div>
          {scopeChecks.length > 0 && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/inbox">View all →</Link>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <ScopeLogTable
            checks={scopeChecks}
            projectId={project.id}
            limit={10}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function ParseBadge({ status }: { status: 'no-contract' | 'pending' | 'parsed' }) {
  if (status === 'no-contract') return <Badge variant="outline">No contract</Badge>;
  if (status === 'pending') return <Badge variant="secondary">Parsing…</Badge>;
  return <Badge variant="success">Parsed</Badge>;
}
