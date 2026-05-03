/**
 * @file app/layout.tsx
 * @description Root layout for the entire app. Sets HTML lang, font variables,
 *              and global metadata. Wraps every route in PostHogProvider so
 *              client-side analytics + $pageview events fire on all pages
 *              (the provider self-disables when NEXT_PUBLIC_POSTHOG_KEY is unset).
 */

import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Suspense } from 'react';
import './globals.css';

import { PostHogProvider } from '@/components/observability/PostHogProvider';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolve the signed-in user (if any) so PostHogProvider can identify
  // them on first paint. Anonymous landing-page visitors get a null
  // distinctId — the provider's `person_profiles: 'identified_only'`
  // setting means anonymous traffic never creates a profile.
  const user = await getCurrentUser();
  const distinctId = user?.id ?? null;
  const identity = user
    ? { planTier: user.planTier, jurisdiction: user.jurisdiction }
    : undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable} font-sans antialiased`}>
        {/* usePathname/useSearchParams in PostHogProvider need a Suspense
            boundary in App Router so static export doesn't error. */}
        <Suspense fallback={null}>
          <PostHogProvider distinctId={distinctId} identity={identity}>
            {children}
          </PostHogProvider>
        </Suspense>
      </body>
    </html>
  );
}
