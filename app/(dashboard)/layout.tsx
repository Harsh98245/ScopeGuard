/**
 * @file app/(dashboard)/layout.tsx
 * @description Authenticated app shell. Loads the current user profile (and
 *              creates it on first visit as a safety net), then renders a
 *              header with a sign-out form and a sidebar navigation. All
 *              dashboard pages render inside this layout.
 *
 *              The middleware already redirects unauthenticated visitors,
 *              but we belt-and-braces with `requireCurrentUser()` here too —
 *              it satisfies the type system and protects against any route
 *              the matcher accidentally lets through.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PostHogIdentify } from '@/components/observability/PostHogProvider';
import { ensureUserProfile } from '@/lib/auth/ensureUserProfile';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const NAV = [
  { href: '/projects', label: 'Projects' },
  { href: '/inbox', label: 'Inbox' },
  { href: '/finances', label: 'Finances' },
  { href: '/settings', label: 'Settings' },
] as const;

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect('/login');

  // Idempotent — creates the row on first dashboard load, no-ops afterwards.
  const user = await ensureUserProfile({ id: authUser.id, email: authUser.email! });

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <Link href="/projects" className="text-sm font-semibold tracking-tight">
            ScopeGuard
          </Link>
          <nav aria-label="Primary" className="hidden gap-6 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-4">
            <span className="hidden text-xs text-muted-foreground sm:inline">{user.email}</span>
            <form action="/api/auth/signout" method="post">
              <button
                type="submit"
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">{children}</main>
      {/* Lazy PostHog identification — root layout can't do this without
          breaking build-time page data collection (see app/layout.tsx). */}
      <PostHogIdentify
        distinctId={user.id}
        identity={{ planTier: user.planTier, jurisdiction: user.jurisdiction }}
      />
    </div>
  );
}
