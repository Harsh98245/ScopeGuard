/**
 * @file app/(dashboard)/inbox/actions.ts
 * @description Server actions for the /inbox surface. Currently exposes one
 *              action: recording what the user did after receiving a verdict
 *              (sent a change order, accepted anyway, or ignored the request).
 *
 *              Access control: every action re-verifies the user's session and
 *              confirms the scope check belongs to one of their projects before
 *              writing. No side-effecting action reads user input without Zod
 *              validation first.
 */

'use server';

import { revalidatePath } from 'next/cache';
import { UserAction } from '@prisma/client';
import { z } from 'zod';

import { requireCurrentUser } from '@/lib/auth/getCurrentUser';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/utils/logger';

const RecordUserActionSchema = z.object({
  scopeCheckId: z.string().uuid('Invalid scope check ID.'),
  userAction: z.nativeEnum(UserAction, { message: 'Invalid user action.' }),
});

export interface RecordUserActionResult {
  ok?: true;
  error?: string;
}

/**
 * Record what the user did after seeing the verdict for a scope check.
 * Silently no-ops if `userAction` is already set (verdicts are immutable;
 * we only allow the first recording).
 *
 * @param formData - Must contain `scopeCheckId` (UUID) and `userAction`
 *   (one of SENT_CHANGE_ORDER | ACCEPTED_ANYWAY | IGNORED).
 * @returns `{ ok: true }` on success or `{ error: string }` on failure.
 */
export async function recordUserActionAction(
  formData: FormData,
): Promise<RecordUserActionResult> {
  const user = await requireCurrentUser('/inbox');

  const raw = {
    scopeCheckId: formData.get('scopeCheckId'),
    userAction: formData.get('userAction'),
  };

  const parsed = RecordUserActionSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? 'Invalid input.' };
  }

  const { scopeCheckId, userAction } = parsed.data;

  // Verify the scope check belongs to the current user (via project join).
  const check = await prisma.scopeCheck.findFirst({
    where: { id: scopeCheckId, project: { userId: user.id } },
    select: { id: true, userAction: true },
  });

  if (!check) {
    return { error: 'Scope check not found.' };
  }

  // First recording wins — never overwrite an already-set action.
  if (check.userAction !== null) {
    return { ok: true };
  }

  await prisma.scopeCheck.update({
    where: { id: check.id },
    data: { userAction },
  });

  logger.info('scope.user_action.recorded', {
    userId: user.id,
    scopeCheckId,
    userAction,
  });

  revalidatePath('/inbox');
  revalidatePath('/projects', 'layout');

  return { ok: true };
}
