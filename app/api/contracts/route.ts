/**
 * @file app/api/contracts/route.ts
 * @description Contract upload endpoint. Accepts multipart form-data with:
 *                - file       (the PDF/DOCX/text contract)
 *                - projectId  (UUID of the owning project)
 *
 *              Flow:
 *                1. Authenticate the user.
 *                2. Verify the project belongs to them.
 *                3. Validate file size + MIME.
 *                4. Stream the buffer to Supabase Storage under
 *                   <userId>/<projectId>/<uuid>.<ext>.
 *                5. Create the Contract row (rawText left null until the
 *                   Inngest function fills it in).
 *                6. Publish `contract/uploaded` to Inngest.
 *                7. Return 201 with the new contract row.
 *
 *              Heavy work (extraction + parseContract) happens in
 *              inngest/functions/parseUploadedContract so the upload
 *              request returns within seconds even for large files.
 */

import { NextResponse } from 'next/server';

import { inngest } from '@/inngest/client';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import {
  MAX_CONTRACT_BYTES,
  isSupportedMime,
} from '@/lib/contracts/extract';
import {
  buildContractStorageKey,
  uploadContractBuffer,
} from '@/lib/contracts/storage';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/utils/logger';
import { contractParseLimiter, checkLimit } from '@/lib/utils/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ApiError {
  error: { code: string; message: string };
}

function err(code: string, message: string, status: number) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

/**
 * POST /api/contracts
 *
 * @returns 201 with the created contract row, or a structured error.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return err('UNAUTHENTICATED', 'Sign in required.', 401);

  const limited = await checkLimit(contractParseLimiter, user.id);
  if (limited) {
    return NextResponse.json<ApiError>(
      { error: { code: 'RATE_LIMITED', message: 'Too many uploads — slow down.' } },
      { status: 429, headers: limited.headers },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return err('INVALID_FORM', 'Body must be multipart/form-data.', 400);
  }

  const file = form.get('file');
  const projectId = form.get('projectId');

  if (!(file instanceof File)) return err('VALIDATION_FAILED', '`file` is required.', 400);
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return err('VALIDATION_FAILED', '`projectId` is required.', 400);
  }
  if (file.size === 0) return err('VALIDATION_FAILED', 'File is empty.', 400);
  if (file.size > MAX_CONTRACT_BYTES) {
    return err('FILE_TOO_LARGE', `Max upload size is ${MAX_CONTRACT_BYTES} bytes.`, 413);
  }
  if (!isSupportedMime(file.type)) {
    return err('UNSUPPORTED_TYPE', `Unsupported file type: ${file.type || 'unknown'}.`, 415);
  }

  // Confirm the project belongs to the caller.
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: user.id },
    select: { id: true },
  });
  if (!project) return err('NOT_FOUND', 'Project not found.', 404);

  const buffer = Buffer.from(await file.arrayBuffer());
  const storageKey = buildContractStorageKey(user.id, project.id, file.name);

  try {
    await uploadContractBuffer(storageKey, buffer, file.type);
  } catch (e) {
    logger.error('contract.upload.storage_failed', {
      userId: user.id,
      projectId: project.id,
      message: e instanceof Error ? e.message : String(e),
    });
    return err('STORAGE_ERROR', 'Could not store the file. Please retry.', 502);
  }

  const contract = await prisma.contract.create({
    data: {
      projectId: project.id,
      fileName: file.name,
      storageKey,
    },
  });

  await inngest.send({
    name: 'contract/uploaded',
    data: { userId: user.id, projectId: project.id, contractId: contract.id },
  });

  logger.info('contract.upload.accepted', {
    userId: user.id,
    projectId: project.id,
    contractId: contract.id,
    bytes: buffer.length,
    mime: file.type,
  });

  return NextResponse.json(
    {
      id: contract.id,
      projectId: contract.projectId,
      fileName: contract.fileName,
      parsedAt: contract.parsedAt,
      createdAt: contract.createdAt,
    },
    { status: 201 },
  );
}
