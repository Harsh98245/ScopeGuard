/**
 * @file app/(dashboard)/projects/page.tsx
 * @description Project list — the default landing page after login.
 *              In this session it renders only the user's inbound alias and
 *              an empty-state CTA. Project CRUD + the contract upload flow
 *              land in session 5.
 */

import type { Metadata } from 'next';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireCurrentUser } from '@/lib/auth/getCurrentUser';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Projects' };

export default async function ProjectsPage() {
  const user = await requireCurrentUser('/projects');
  const projects = await prisma.project.findMany({
    where: { userId: user.id, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <p className="text-sm text-muted-foreground">
          Forward client emails to <code className="font-mono text-foreground">{user.inboundEmailAlias}</code>
          {' '}— ScopeGuard will tag the matching project automatically.
        </p>
      </header>

      {projects.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Create your first project</CardTitle>
            <CardDescription>
              Start by uploading the signed contract. ScopeGuard will extract the deliverables and
              flag any ambiguous language before your client can exploit it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Project creation lands in the next build session. For now, this confirms you&apos;re
              authenticated and your profile row exists.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <li key={p.id}>
              <Card>
                <CardHeader>
                  <CardTitle>{p.name}</CardTitle>
                  <CardDescription>{p.clientName}</CardDescription>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
