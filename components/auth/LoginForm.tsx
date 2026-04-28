/**
 * @file components/auth/LoginForm.tsx
 * @description Email + password login form. Uses React's useFormState +
 *              useFormStatus so the server action's structured error appears
 *              inline and the submit button shows a pending state during
 *              the round trip.
 */

'use client';

import Link from 'next/link';
import { useFormState, useFormStatus } from 'react-dom';

import { type AuthActionResult, googleSignInAction, loginAction } from '@/app/(auth)/actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const initialState: AuthActionResult = {};

export interface LoginFormProps {
  /** Path to redirect to after a successful login. */
  next?: string;
  /** Initial server-side error (e.g. ?error=invalid_code from the callback). */
  initialError?: string;
}

export function LoginForm({ next, initialError }: LoginFormProps) {
  const [state, formAction] = useFormState(loginAction, initialState);
  const renderedError = state.error ?? initialError;

  return (
    <div className="space-y-4">
      {renderedError ? (
        <Alert variant="destructive">
          <AlertDescription>{renderedError}</AlertDescription>
        </Alert>
      ) : null}

      <form action={formAction} className="space-y-4" noValidate>
        {next ? <input type="hidden" name="next" value={next} /> : null}

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            inputMode="email"
            placeholder="you@example.com"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
          />
        </div>

        <SubmitButton label="Log in" />
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">or</span>
        </div>
      </div>

      <form action={googleSignInAction}>
        <Button type="submit" variant="outline" className="w-full">
          Continue with Google
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending} aria-disabled={pending}>
      {pending ? 'Working…' : label}
    </Button>
  );
}
