/**
 * @file components/scope/InboxRealtimeFeed.tsx
 * @description Zero-height client island that holds a Supabase Realtime
 *              subscription on the `scope_checks` table. On any INSERT event,
 *              it calls `router.refresh()` so the parent server component
 *              re-fetches and renders the latest verdicts without a hard
 *              navigation.
 *
 *              Security note: no data is read from the Realtime payload — only
 *              the raw INSERT notification is used as a trigger. All data comes
 *              from the server-side Prisma query in the parent page, which
 *              enforces RLS via the user's session. A Realtime INSERT from
 *              another user's scope check will trigger an unnecessary refresh
 *              (a performance no-op) but will never expose that user's data.
 *
 *              Pre-requisite: the `scope_checks` table must be added to the
 *              Supabase realtime publication. See docs/RUNBOOK.md §
 *              "Enabling Realtime for scope_checks".
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { createSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Mounts a Supabase Realtime subscription and triggers a server-component
 * refresh on every INSERT to `scope_checks`. Renders nothing to the DOM.
 */
export function InboxRealtimeFeed() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    const channel = supabase
      .channel('inbox-scope-checks-feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'scope_checks' },
        () => {
          router.refresh();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
