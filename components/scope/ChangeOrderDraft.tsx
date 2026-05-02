/**
 * @file components/scope/ChangeOrderDraft.tsx
 * @description Client island that renders a labelled, copy-to-clipboard text
 *              block. Used for both the drafted polite decline and the
 *              change-order text that `checkScope` produces.
 */

'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

interface ChangeOrderDraftProps {
  /** Label displayed above the block (e.g. "Drafted reply" or "Change order"). */
  title: string;
  /** The text to display and copy. Must be a non-empty string. */
  text: string;
  className?: string;
}

/**
 * Renders `text` inside a styled pre block with a copy button. The button
 * shows a "Copied!" confirmation for 2 seconds then resets.
 *
 * @param props - See {@link ChangeOrderDraftProps}.
 */
export function ChangeOrderDraft({ title, text, className }: ChangeOrderDraftProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API blocked (e.g. in a non-HTTPS context). Silently fail —
      // the user can still manually select + copy the text.
    }
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopy}
          aria-label={`Copy ${title}`}
          className="h-6 px-2 text-xs"
        >
          {copied ? 'Copied!' : 'Copy'}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-md bg-muted p-3 font-sans text-sm leading-relaxed whitespace-pre-wrap">
        {text}
      </pre>
    </div>
  );
}
