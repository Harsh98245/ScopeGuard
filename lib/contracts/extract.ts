/**
 * @file lib/contracts/extract.ts
 * @description Text extraction from uploaded contract documents. Dispatches
 *              on MIME type / file extension and returns plain text suitable
 *              for parseContract.
 *
 *              Server-only — pdf-parse and mammoth both depend on Node APIs
 *              and ship with native code in mammoth's case.
 *
 *              The extractors are pure: they accept a Buffer and return the
 *              extracted plain text. Any I/O (downloading from Storage,
 *              writing back to Postgres) is the caller's concern.
 */

import 'server-only';

/** MIME types we accept for contract uploads. */
export const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'text/plain',
  'text/markdown',
] as const;

export type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

/** Hard cap on input bytes — matches the Storage upload limit. 10 MB. */
export const MAX_CONTRACT_BYTES = 10 * 1024 * 1024;

/** Hard cap on extracted text length. Anything beyond gets truncated with a
 *  trailing ellipsis so parseContract still receives a finite payload. */
export const MAX_EXTRACTED_CHARS = 120_000;

export class UnsupportedFileTypeError extends Error {
  constructor(mime: string) {
    super(`Unsupported contract file type: ${mime}`);
    this.name = 'UnsupportedFileTypeError';
  }
}

export class ContractTooLargeError extends Error {
  constructor(bytes: number) {
    super(`Contract file is ${bytes} bytes; max ${MAX_CONTRACT_BYTES} bytes.`);
    this.name = 'ContractTooLargeError';
  }
}

export class ExtractionFailedError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ExtractionFailedError';
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause;
  }
}

/**
 * Type-guard for the MIME types this module knows how to handle.
 *
 * @param mime - MIME type from the upload (`File.type` or `Content-Type`).
 * @returns true when the MIME is in the {@link SUPPORTED_MIME_TYPES} list.
 */
export function isSupportedMime(mime: string): mime is SupportedMimeType {
  return (SUPPORTED_MIME_TYPES as readonly string[]).includes(mime);
}

/**
 * Extract plain text from a contract file buffer.
 *
 * @param buffer - Raw file bytes.
 * @param mime - MIME type. Must be one of {@link SUPPORTED_MIME_TYPES}.
 * @returns Trimmed plain text, truncated to {@link MAX_EXTRACTED_CHARS}.
 * @throws {@link UnsupportedFileTypeError} when `mime` isn't recognised.
 * @throws {@link ContractTooLargeError} when `buffer.length` exceeds the cap.
 * @throws {@link ExtractionFailedError} when the underlying parser fails.
 *
 * @example
 *   const text = await extractContractText(fileBuffer, 'application/pdf');
 *   const parsed = await parseContract({ contractText: text });
 */
export async function extractContractText(buffer: Buffer, mime: string): Promise<string> {
  if (buffer.length > MAX_CONTRACT_BYTES) {
    throw new ContractTooLargeError(buffer.length);
  }
  if (!isSupportedMime(mime)) {
    throw new UnsupportedFileTypeError(mime);
  }

  let raw: string;
  try {
    if (mime === 'application/pdf') {
      raw = await extractFromPdf(buffer);
    } else if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      raw = await extractFromDocx(buffer);
    } else {
      // text/plain or text/markdown — assume UTF-8.
      raw = buffer.toString('utf8');
    }
  } catch (err) {
    throw new ExtractionFailedError(
      err instanceof Error ? err.message : 'Unknown extraction failure',
      err,
    );
  }

  return truncate(normaliseWhitespace(raw));
}

async function extractFromPdf(buffer: Buffer): Promise<string> {
  // Dynamic import — pdf-parse is only loaded on the code path that needs it,
  // and lets us mock it cleanly in tests.
  const mod = (await import('pdf-parse')) as unknown as {
    default: (data: Buffer) => Promise<{ text: string }>;
  };
  const result = await mod.default(buffer);
  return result.text ?? '';
}

async function extractFromDocx(buffer: Buffer): Promise<string> {
  const mod = (await import('mammoth')) as unknown as {
    extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
  };
  const result = await mod.extractRawText({ buffer });
  return result.value ?? '';
}

/** Collapse runs of whitespace and strip BOM / control chars that confuse Claude. */
function normaliseWhitespace(text: string): string {
  return text
    .replace(/﻿/g, '') // BOM
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncate(text: string): string {
  if (text.length <= MAX_EXTRACTED_CHARS) return text;
  return `${text.slice(0, MAX_EXTRACTED_CHARS)}\n\n[truncated — original was ${text.length} chars]`;
}
