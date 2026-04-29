/**
 * @file lib/contracts/storage.ts
 * @description Supabase Storage helpers for the `contracts` bucket. Object
 *              keys follow `<userId>/<projectId>/<uuid>.<ext>` so RLS-style
 *              path-prefix policies can guard reads (the bucket itself is
 *              private; we issue signed URLs when a UI needs to render the
 *              original file).
 *
 *              Server-only — uses the service-role client because Storage
 *              writes during the upload route happen before the user's RLS-
 *              filtered Prisma operations.
 */

import 'server-only';

import { randomUUID } from 'node:crypto';

import { createSupabaseAdminClient } from '@/lib/supabase/server';

/** Storage bucket name. Created out-of-band via the Supabase dashboard. */
export const CONTRACTS_BUCKET = 'contracts';

/** TTL for short-lived signed URLs (15 minutes). */
const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 15;

/**
 * Build the canonical storage key for a contract upload.
 *
 * @param userId - Owning user's UUID.
 * @param projectId - Owning project's UUID.
 * @param fileName - Original filename — used only to preserve the extension.
 * @returns Object key, e.g. `4f.../9b.../e2c1...pdf`.
 */
export function buildContractStorageKey(
  userId: string,
  projectId: string,
  fileName: string,
): string {
  const ext = extensionOf(fileName);
  const id = randomUUID();
  return `${userId}/${projectId}/${id}${ext ? `.${ext}` : ''}`;
}

/**
 * Upload a contract buffer to Supabase Storage.
 *
 * @param key - The object key from {@link buildContractStorageKey}.
 * @param buffer - Raw file bytes.
 * @param contentType - The original MIME type.
 * @returns The same `key` on success.
 * @throws Error when the upload fails — message excludes credentials.
 */
export async function uploadContractBuffer(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.storage.from(CONTRACTS_BUCKET).upload(key, buffer, {
    contentType,
    upsert: false,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return key;
}

/**
 * Download a previously-uploaded contract by its storage key.
 *
 * @param key - Object key as written by {@link uploadContractBuffer}.
 * @returns Raw file bytes.
 * @throws Error when the object cannot be retrieved.
 */
export async function downloadContractBuffer(key: string): Promise<Buffer> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.storage.from(CONTRACTS_BUCKET).download(key);
  if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? 'no data'}`);
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Issue a short-lived signed URL for the contract object so a browser can
 * render the original file. Use only when the user genuinely needs the
 * source PDF — most UI surfaces should render the *parsed* text instead.
 *
 * @param key - Object key.
 * @param ttlSeconds - URL lifetime. Defaults to 15 minutes.
 * @returns A signed HTTPS URL.
 */
export async function getSignedContractUrl(
  key: string,
  ttlSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS,
): Promise<string> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.storage
    .from(CONTRACTS_BUCKET)
    .createSignedUrl(key, ttlSeconds);
  if (error || !data) throw new Error(`Signed URL failed: ${error?.message ?? 'no data'}`);
  return data.signedUrl;
}

/**
 * Best-effort delete. Used during contract row deletion so we don't leak
 * objects in Storage when the user removes a contract.
 *
 * @param key - Object key.
 */
export async function deleteContractObject(key: string): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.storage.from(CONTRACTS_BUCKET).remove([key]);
  if (error) throw new Error(`Storage delete failed: ${error.message}`);
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot === fileName.length - 1) return '';
  return fileName.slice(dot + 1).toLowerCase();
}
