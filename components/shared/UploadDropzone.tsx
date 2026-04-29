/**
 * @file components/shared/UploadDropzone.tsx
 * @description Drag-and-drop upload control for contracts. Posts a
 *              multipart form to /api/contracts and refreshes the page once
 *              the row exists. The actual parsing happens async in Inngest;
 *              the page re-renders to show "Parsing…" → "Parsed" as the
 *              user navigates back.
 *
 *              Keyboard accessible: the surface is a focusable button that
 *              opens the file picker on Enter/Space.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useId, useRef, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

const ACCEPT =
  'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,.pdf,.docx,.txt,.md';

/** 10 MB hard cap mirrored from lib/contracts/extract.MAX_CONTRACT_BYTES. */
const MAX_BYTES = 10 * 1024 * 1024;

export interface UploadDropzoneProps {
  /** UUID of the owning project. Sent as the `projectId` form field. */
  projectId: string;
}

export function UploadDropzone({ projectId }: UploadDropzoneProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);

      if (file.size === 0) {
        setError('File is empty.');
        return;
      }
      if (file.size > MAX_BYTES) {
        setError(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB. Max 10 MB.`);
        return;
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('projectId', projectId);

      setBusy(true);
      try {
        const res = await fetch('/api/contracts', { method: 'POST', body: formData });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          setError(body?.error?.message ?? `Upload failed (${res.status}).`);
          return;
        }
        // Server-rendered page rereads the contract row.
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed.');
      } finally {
        setBusy(false);
      }
    },
    [projectId, router],
  );

  return (
    <div className="space-y-3">
      <label
        htmlFor={inputId}
        className={cn(
          'flex min-h-[160px] cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-input bg-background p-6 text-center transition-colors',
          'hover:border-foreground/40',
          dragOver && 'border-foreground bg-accent',
          busy && 'pointer-events-none opacity-60',
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) void handleFile(file);
        }}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            // Reset so re-selecting the same file fires onChange.
            e.target.value = '';
          }}
        />
        <p className="text-sm font-medium">
          {busy ? 'Uploading…' : 'Drop your contract here, or click to choose'}
        </p>
        <p className="text-xs text-muted-foreground">PDF or DOCX · up to 10 MB</p>
      </label>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          Choose file
        </Button>
      </div>
    </div>
  );
}
