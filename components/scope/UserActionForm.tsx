/**
 * @file components/scope/UserActionForm.tsx
 * @description Client island for recording what the user did after receiving
 *              a scope-check verdict. Presents three action buttons; calls the
 *              `recordUserActionAction` server action on click.
 *
 *              Rendered only when `userAction` is null on the ScopeCheck row.
 *              Once an action is recorded the parent page re-validates via
 *              `revalidatePath`, replacing this island with a read-only label.
 */

'use client';

import { useOptimistic, useTransition } from 'react';

import { recordUserActionAction } from '@/app/(dashboard)/inbox/actions';
import { Button } from '@/components/ui/button';
import type { UserAction } from '@prisma/client';

interface UserActionFormProps {
  /** The scope check whose action the user is recording. */
  scopeCheckId: string;
}

const ACTION_LABELS: Record<UserAction, string> = {
  SENT_CHANGE_ORDER: 'Sent change order',
  ACCEPTED_ANYWAY: 'Accepted anyway',
  IGNORED: 'Ignored',
};

/**
 * Three-button form for recording the user's response to a verdict.
 * Uses `useOptimistic` to hide the buttons immediately on click without
 * waiting for the server action to complete.
 *
 * @param props - See {@link UserActionFormProps}.
 */
export function UserActionForm({ scopeCheckId }: UserActionFormProps) {
  const [isPending, startTransition] = useTransition();
  const [optimisticAction, setOptimisticAction] = useOptimistic<UserAction | null>(null);

  function handleAction(action: UserAction) {
    const fd = new FormData();
    fd.set('scopeCheckId', scopeCheckId);
    fd.set('userAction', action);

    startTransition(async () => {
      setOptimisticAction(action);
      await recordUserActionAction(fd);
    });
  }

  if (optimisticAction !== null) {
    return (
      <p className="text-xs text-muted-foreground">
        Marked as: <span className="font-medium">{ACTION_LABELS[optimisticAction]}</span>
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-xs text-muted-foreground">What did you do?</p>
      {(
        [
          'SENT_CHANGE_ORDER',
          'ACCEPTED_ANYWAY',
          'IGNORED',
        ] as const
      ).map((action) => (
        <Button
          key={action}
          size="sm"
          variant={action === 'IGNORED' ? 'ghost' : 'outline'}
          disabled={isPending}
          onClick={() => handleAction(action)}
          className="h-6 px-2 text-xs"
        >
          {ACTION_LABELS[action]}
        </Button>
      ))}
    </div>
  );
}
