/**
 * @file app/layout.tsx
 * @description Root layout for the entire app. Sets HTML lang, font variables,
 *              and global metadata. Mounts PostHogProvider so client-side
 *              $pageview events fire on every route (the provider self-disables
 *              when NEXT_PUBLIC_POSTHOG_KEY is unset).
 *
 *              IMPORTANT: this layout MUST NOT call any server-side function
 *              that requires a request context (cookies, headers, Supabase
 *              auth). Doing so makes every route dynamic AND breaks
 *              `next build`'s page data collection — caught the hard way
 *              when an earlier `await getCurrentUser()` here failed
 *              `/api/auth/callback` build-time analysis.
 *
 *              User identification for PostHog happens lazily from
 *              `app/(dashboard)/layout.tsx` instead, where we already need
 *              the signed-in user and the request context is real.
 */

import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Suspense } from 'react';
import './globals.css';

import { PostHogProvider } from '@/components/observability/PostHogProvider';

const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'ScopeGuard', template: '%s · ScopeGuard' },
  description:
    'AI-powered scope enforcement and financial OS for freelancers and solopreneurs.',
  applicationName: 'ScopeGuard',
  authors: [{ name: 'ScopeGuard' }],
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1120' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable} font-sans antialiased`}>
        {/* PostHogProvider uses useSearchParams — Suspense satisfies App Router's
            requirement to bound that hook. distinctId is null here; the
            dashboard layout will identify the user once they're signed in. */}
        <Suspense fallback={null}>
          <PostHogProvider distinctId={null}>{children}</PostHogProvider>
        </Suspense>
      </body>
    </html>
  );
}
