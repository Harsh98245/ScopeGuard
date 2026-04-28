/**
 * @file app/(auth)/signup/page.tsx
 * @description Signup page wrapper. Real form lives in components/auth/SignupForm.
 */

import type { Metadata } from 'next';

import { SignupForm } from '@/components/auth/SignupForm';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Sign up',
  description: 'Create your ScopeGuard account.',
};

interface SignupPageProps {
  searchParams: { next?: string };
}

export default function SignupPage({ searchParams }: SignupPageProps) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle>Create your account</CardTitle>
        <CardDescription>
          Free to start — paid plans unlock unlimited projects and the Financial OS.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SignupForm {...(searchParams.next ? { next: searchParams.next } : {})} />
      </CardContent>
    </Card>
  );
}
