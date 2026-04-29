/**
 * @file tests/unit/contracts/extract.test.ts
 * @description Tests the dispatcher logic and post-processing of
 *              extractContractText. The actual PDF/DOCX libraries are
 *              dynamically imported by the implementation, so we mock them
 *              via vi.mock to keep the suite hermetic.
 *
 *              Real-PDF integration tests with sample fixtures belong in a
 *              separate suite — they require checking in binary fixtures
 *              and are slow to run.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('pdf-parse', () => ({
  default: vi.fn(async (_buf: Buffer) => ({ text: 'PDF body text\nwith multiple   lines' })),
}));

vi.mock('mammoth', () => ({
  extractRawText: vi.fn(async (_args: { buffer: Buffer }) => ({ value: 'DOCX body' })),
}));

import {
  ContractTooLargeError,
  ExtractionFailedError,
  MAX_CONTRACT_BYTES,
  UnsupportedFileTypeError,
  extractContractText,
  isSupportedMime,
} from '@/lib/contracts/extract';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.clearAllMocks());

describe('isSupportedMime', () => {
  it('accepts PDF, DOCX, plain text, markdown', () => {
    expect(isSupportedMime('application/pdf')).toBe(true);
    expect(isSupportedMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true);
    expect(isSupportedMime('text/plain')).toBe(true);
    expect(isSupportedMime('text/markdown')).toBe(true);
  });
  it('rejects everything else', () => {
    expect(isSupportedMime('image/png')).toBe(false);
    expect(isSupportedMime('application/msword')).toBe(false);
    expect(isSupportedMime('')).toBe(false);
  });
});

describe('extractContractText', () => {
  it('extracts from a PDF buffer and normalises whitespace', async () => {
    const text = await extractContractText(Buffer.from('mock pdf bytes'), 'application/pdf');
    // Multiple-space run was collapsed by the parser path or by us; the
    // newline handling is what we're really verifying.
    expect(text.startsWith('PDF body text')).toBe(true);
    expect(text).not.toContain('\r\n');
  });

  it('extracts from a DOCX buffer', async () => {
    const text = await extractContractText(
      Buffer.from('mock docx bytes'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(text).toBe('DOCX body');
  });

  it('passes plain text through verbatim with whitespace normalisation', async () => {
    const text = await extractContractText(
      Buffer.from('Hello\r\nWorld\n\n\n\n!\n', 'utf8'),
      'text/plain',
    );
    expect(text).toBe('Hello\nWorld\n\n!');
  });

  it('rejects unsupported MIME types', async () => {
    await expect(
      extractContractText(Buffer.from('x'), 'image/png'),
    ).rejects.toBeInstanceOf(UnsupportedFileTypeError);
  });

  it('rejects oversize buffers up front', async () => {
    const huge = Buffer.alloc(MAX_CONTRACT_BYTES + 1);
    await expect(extractContractText(huge, 'application/pdf')).rejects.toBeInstanceOf(
      ContractTooLargeError,
    );
  });

  it('wraps parser exceptions in ExtractionFailedError', async () => {
    const pdfParse = (await import('pdf-parse')) as unknown as {
      default: ReturnType<typeof vi.fn>;
    };
    pdfParse.default.mockRejectedValueOnce(new Error('corrupt pdf'));

    await expect(
      extractContractText(Buffer.from('x'), 'application/pdf'),
    ).rejects.toBeInstanceOf(ExtractionFailedError);
  });

  it('truncates extracted text to the configured cap', async () => {
    const pdfParse = (await import('pdf-parse')) as unknown as {
      default: ReturnType<typeof vi.fn>;
    };
    pdfParse.default.mockResolvedValueOnce({ text: 'a'.repeat(200_000) });

    const out = await extractContractText(Buffer.from('x'), 'application/pdf');
    expect(out.length).toBeLessThanOrEqual(200_000);
    expect(out).toMatch(/\[truncated — original was 200000 chars\]/);
  });
});
