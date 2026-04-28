/**
 * @file app/(auth)/login/page.tsx
 * @description Login page. Server-rendered — the form itself is a client
 *              island. Reads the optional `next` and `error` query params
 *              and forwards them to the form.
 */

import type { Metadata } from 'next';

import { LoginForm } from '@/components/auth/LoginForm';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Log in',
  description: 'Sign in to your ScopeGuard account.',
};

interface LoginPageProps {
  searchParams: { next?: string; error?: string };
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle>Welcome back</CardTitle>
        <CardDescription>Enter your email and password to continue.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm
          {...(searchParams.next ? { next: searchParams.next } : {})}
          {...(searchParams.error ? { initialError: friendlyError(searchParams.error) } : {})}
        />
      </CardContent>
    </Card>
  );
}

function friendlyError(code: string): string {
  switch (code) {
    case 'invalid_code':
      return 'Your confirmation link expired. Please log in again.';
    case 'missing_code':
      return 'That sign-in link was invalid. Please try again.';
    case 'profile_provisioning_failed':
      return 'We could not finish setting up your account. Please contact support.';
    default:
      return decodeURIComponent(code);
  }
}
