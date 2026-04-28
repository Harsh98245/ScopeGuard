/**
 * @file app/not-found.tsx
 * @description Default 404 page. Future: branded illustration + helpful links.
 */

import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm uppercase tracking-wide text-muted-foreground">404</p>
      <h1 className="text-3xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-muted-foreground">The page you were looking for has moved or never existed.</p>
      <Link
        href="/"
        className="mt-2 inline-flex h-10 items-center rounded-md border border-border px-5 text-sm font-medium hover:bg-secondary"
      >
        Back home
      </Link>
    </main>
  );
}
