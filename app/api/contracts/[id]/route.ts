/**
 * @file app/api/contracts/[id]/route.ts
 * @description Single-contract endpoints used by the dashboard for status
 *              polling (GET) and removal (DELETE).
 *
 *              GET returns just the safe fields; rawText and signed Storage
 *              URLs are intentionally NOT in the payload — request those
 *              separately when needed.
 */

import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { deleteContractObject } from '@/lib/contracts/storage';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ApiError {
  error: { code: string; message: string };
}

function err(code: string, message: string, status: number) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

interface RouteContext {
  params: { id: string };
}

/**
 * GET /api/contracts/:id
 *
 * @returns 200 with a contract summary + parsed structure when ready.
 */
export async function GET(_req: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return err('UNAUTHENTICATED', 'Sign in required.', 401);

  const contract = await prisma.contract.findFirst({
    where: { id: params.id, project: { userId: user.id } },
    select: {
      id: true,
      projectId: true,
      fileName: true,
      parsedAt: true,
      deliverables: true,
      exclusions: true,
      paymentTerms: true,
      overallRiskScore: true,
      createdAt: true,
    },
  });
  if (!contract) return err('NOT_FOUND', 'Contract not found.', 404);

  return NextResponse.json(contract);
}

/**
 * DELETE /api/contracts/:id
 *
 * Removes the row and best-effort deletes the Storage object. Storage
 * deletion failure does NOT roll back the row delete — orphaned objects
 * are cleaned up by a periodic sweep (TBD).
 */
export async function DELETE(_req: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return err('UNAUTHENTICATED', 'Sign in required.', 401);

  const contract = await prisma.contract.findFirst({
    where: { id: params.id, project: { userId: user.id } },
    select: { id: true, storageKey: true },
  });
  if (!contract) return err('NOT_FOUND', 'Contract not found.', 404);

  await prisma.contract.delete({ where: { id: contract.id } });

  try {
    await deleteContractObject(contract.storageKey);
  } catch (e) {
    logger.warn('contract.delete.storage_orphan', {
      contractId: contract.id,
      storageKey: contract.storageKey,
      message: e instanceof Error ? e.message : String(e),
    });
  }

  return new NextResponse(null, { status: 204 });
}
