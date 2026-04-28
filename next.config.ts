/**
 * @file next.config.ts
 * @description Next.js configuration. Sets strict security headers, CSP, image
 *              allowlist for Supabase Storage, and webpack tweaks needed for
 *              the pdf-parse dependency in serverless functions.
 * @author ScopeGuard
 * @lastModified 2026-04-27
 */

import type { NextConfig } from 'next';

/**
 * Build the Content Security Policy header value.
 *
 * The CSP is intentionally strict. When adding a third-party domain (e.g. a new
 * analytics provider), allowlist it explicitly here rather than loosening the
 * existing directives. `'unsafe-inline'` for styles is required by Tailwind
 * preflight in dev; consider replacing with hashes in a follow-up.
 *
 * @returns The CSP header value as a single-line string.
 */
function buildCsp(): string {
  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '';
  const posthogHost = process.env['NEXT_PUBLIC_POSTHOG_HOST'] ?? 'https://us.i.posthog.com';

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      "'unsafe-inline'",
      "'unsafe-eval'",
      'https://js.stripe.com',
      'https://*.posthog.com',
    ],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', supabaseUrl, 'https://*.stripe.com'].filter(Boolean),
    'font-src': ["'self'", 'data:'],
    'connect-src': [
      "'self'",
      supabaseUrl,
      supabaseUrl.replace('https://', 'wss://'),
      'https://api.anthropic.com',
      'https://api.stripe.com',
      posthogHost,
      'https://*.ingest.sentry.io',
    ].filter(Boolean),
    'frame-src': ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'upgrade-insecure-requests': [],
  };

  return Object.entries(directives)
    .map(([key, values]) => (values.length === 0 ? key : `${key} ${values.join(' ')}`))
    .join('; ');
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,

  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },

  images: {
    remotePatterns: [
      // Supabase Storage public + signed URLs
      { protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/**' },
    ],
  },

  // pdf-parse ships with a debug harness that reads a test PDF from disk on
  // require. Mark it external so webpack doesn't try to bundle the test file.
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals ?? []), 'pdf-parse'];
    }
    return config;
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: buildCsp() },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
