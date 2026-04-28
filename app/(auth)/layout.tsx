/**
 * @file app/(auth)/layout.tsx
 * @description Layout for the unauthenticated auth surface (/login, /signup).
 *              Centred single-column with a small brand mark — no app chrome
 *              so first-time visitors aren't confronted with an empty
 *              dashboard nav.
 */

import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background p-6">
      <Link
        href="/"
        className="text-sm font-medium tracking-tight text-muted-foreground hover:text-foreground"
      >
        ScopeGuard
      </Link>
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
