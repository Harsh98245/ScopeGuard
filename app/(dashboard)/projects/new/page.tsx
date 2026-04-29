/**
 * @file app/(dashboard)/projects/new/page.tsx
 * @description New-project form page. Posts to createProjectAction which
 *              redirects to /projects/<id> on success.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { NewProjectForm } from '@/components/projects/NewProjectForm';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const metadata: Metadata = { title: 'New project' };

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Link
        href="/projects"
        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Back to projects
      </Link>
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle>New project</CardTitle>
          <CardDescription>
            Add the client and the rate. Upload the contract on the next step.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewProjectForm />
        </CardContent>
      </Card>
    </div>
  );
}
