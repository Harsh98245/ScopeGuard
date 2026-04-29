/**
 * @file app/(dashboard)/projects/page.tsx
 * @description Project list — the default landing page after login.
 *              Surfaces the user's inbound alias prominently and renders a
 *              card grid of active projects with a "New project" CTA.
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
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Projects' };

export default async function ProjectsPage() {
  const user = await requireCurrentUser('/projects');
  const projects = await prisma.project.findMany({
    where: { userId: user.id, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      _count: { select: { contracts: true, scopeChecks: true } },
    },
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Forward client emails to{' '}
            <code className="font-mono text-foreground">{user.inboundEmailAlias}</code>{' '}
            — ScopeGuard will tag the matching project automatically.
          </p>
        </div>
        <Button asChild>
          <Link href="/projects/new">New project</Link>
        </Button>
      </header>

      {projects.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Create your first project</CardTitle>
            <CardDescription>
              Start with a project, then upload the signed contract. ScopeGuard will extract the
              deliverables and flag any ambiguous language before your client can exploit it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/projects/new">Create a project</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`} className="block focus:outline-none">
                <Card className="transition-colors hover:border-foreground/40">
                  <CardHeader>
                    <CardTitle className="text-lg">{p.name}</CardTitle>
                    <CardDescription>{p.clientName}</CardDescription>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    {p._count.contracts} contract{p._count.contracts === 1 ? '' : 's'} ·{' '}
                    {p._count.scopeChecks} scope check{p._count.scopeChecks === 1 ? '' : 's'}
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
