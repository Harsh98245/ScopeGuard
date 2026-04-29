/**
 * @file app/(dashboard)/projects/actions.ts
 * @description Server actions for project CRUD. Used by the new-project form
 *              and (later) the project settings page. All actions Zod-
 *              validate the FormData and run inside the user's own RLS
 *              context — Prisma uses the singleton client which connects
 *              with the service role, so we still scope every query by
 *              userId in the WHERE clause as defence-in-depth.
 */

'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requireCurrentUser } from '@/lib/auth/getCurrentUser';
import { logger } from '@/lib/utils/logger';
import { CurrencyCodeSchema, EmailSchema, MoneyStringSchema } from '@/lib/utils/validation';
import { prisma } from '@/lib/prisma';

export interface ProjectActionResult {
  error?: string;
  fieldErrors?: Partial<Record<'name' | 'clientName' | 'clientEmail' | 'hourlyRate' | 'currency', string>>;
}

const CreateProjectSchema = z.object({
  name: z.string().min(1, 'Name is required.').max(120),
  clientName: z.string().min(1, 'Client name is required.').max(120),
  clientEmail: z
    .union([EmailSchema, z.literal('')])
    .transform((v) => (v === '' ? undefined : v))
    .optional(),
  hourlyRate: z
    .union([MoneyStringSchema, z.literal('')])
    .transform((v) => (v === '' ? undefined : v))
    .optional(),
  currency: z
    .union([CurrencyCodeSchema, z.literal('')])
    .transform((v) => (v === '' || v === undefined ? 'USD' : v)),
});

/**
 * Create a new project for the signed-in user. Redirects to the new
 * project's detail page on success.
 */
export async function createProjectAction(
  _prev: ProjectActionResult,
  formData: FormData,
): Promise<ProjectActionResult> {
  const user = await requireCurrentUser('/projects/new');

  const parsed = CreateProjectSchema.safeParse({
    name: formData.get('name') ?? '',
    clientName: formData.get('clientName') ?? '',
    clientEmail: formData.get('clientEmail') ?? '',
    hourlyRate: formData.get('hourlyRate') ?? '',
    currency: formData.get('currency') ?? '',
  });
  if (!parsed.success) {
    const fieldErrors: ProjectActionResult['fieldErrors'] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof NonNullable<ProjectActionResult['fieldErrors']>;
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.', fieldErrors };
  }

  const project = await prisma.project.create({
    data: {
      userId: user.id,
      name: parsed.data.name,
      clientName: parsed.data.clientName,
      clientEmail: parsed.data.clientEmail ?? null,
      hourlyRate: parsed.data.hourlyRate ?? null,
      currency: parsed.data.currency,
    },
  });

  logger.info('project.created', { userId: user.id, projectId: project.id });

  revalidatePath('/projects');
  redirect(`/projects/${project.id}`);
}
