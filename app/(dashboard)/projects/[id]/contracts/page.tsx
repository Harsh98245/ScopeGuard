/**
 * @file app/(dashboard)/projects/[id]/contracts/page.tsx
 * @description Contract upload + parsed-clause viewer. Shows the latest
 *              contract's parsed structure (deliverables, exclusions,
 *              ambiguous flags, risk score) once the Inngest function has
 *              filled it in. Polling for status lives in the client island
 *              UploadDropzone — this page is server-rendered and shows the
 *              committed state.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ContractClauseViewer } from '@/components/scope/ContractClauseViewer';
import { UploadDropzone } from '@/components/shared/UploadDropzone';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { requireCurrentUser } from '@/lib/auth/getCurrentUser';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Contracts' };

interface ContractsPageProps {
  params: { id: string };
}

export default async function ContractsPage({ params }: ContractsPageProps) {
  const user = await requireCurrentUser(`/projects/${params.id}/contracts`);

  const project = await prisma.project.findFirst({
    where: { id: params.id, userId: user.id },
    include: {
      contracts: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  });
  if (!project) notFound();

  const latest = project.contracts[0] ?? null;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link
          href={`/projects/${project.id}`}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← {project.name}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Contracts</h1>
        <p className="text-sm text-muted-foreground">
          Upload the signed contract. ScopeGuard extracts deliverables, flags ambiguous language,
          and scores overall scope-dispute risk.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Upload</CardTitle>
          <CardDescription>
            PDF or DOCX. Up to 10 MB. Parsing typically completes within a minute.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UploadDropzone projectId={project.id} />
        </CardContent>
      </Card>

      {latest ? (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div className="space-y-1">
              <CardTitle className="text-lg">{latest.fileName}</CardTitle>
              <CardDescription>
                Uploaded {latest.createdAt.toISOString().slice(0, 10)}
                {latest.parsedAt ? ` · parsed ${latest.parsedAt.toISOString().slice(0, 10)}` : ''}
              </CardDescription>
            </div>
            {latest.parsedAt ? (
              latest.overallRiskScore !== null && latest.overallRiskScore !== undefined ? (
                <Badge variant={latest.overallRiskScore >= 7 ? 'destructive' : 'secondary'}>
                  Risk {latest.overallRiskScore}/10
                </Badge>
              ) : (
                <Badge variant="success">Parsed</Badge>
              )
            ) : (
              <Badge variant="secondary">Parsing…</Badge>
            )}
          </CardHeader>
          <CardContent>
            <ContractClauseViewer
              parsedAt={latest.parsedAt?.toISOString() ?? null}
              deliverables={(latest.deliverables ?? []) as never[]}
              exclusions={(latest.exclusions ?? []) as never[]}
              paymentTerms={(latest.paymentTerms ?? null) as never}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
