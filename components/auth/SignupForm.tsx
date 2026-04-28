/**
 * @file components/auth/SignupForm.tsx
 * @description Signup form. On successful submit Supabase emails a
 *              confirmation link — we render a confirmation panel rather
 *              than redirecting, since the user has no session yet.
 *
 *              Captures `Intl.DateTimeFormat().resolvedOptions().timeZone`
 *              from the browser so the user's first dashboard render
 *              already uses their local time.
 */

'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import { type AuthActionResult, googleSignInAction, signupAction } from '@/app/(auth)/actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const initialState: AuthActionResult = {};

export interface SignupFormProps {
  next?: string;
}

export function SignupForm({ next }: SignupFormProps) {
  const [state, formAction] = useFormState(signupAction, initialState);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const tzRef = useRef<HTMLInputElement>(null);

  // Browser-supplied IANA tz hint.
  useEffect(() => {
    if (!tzRef.current) return;
    try {
      tzRef.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    } catch {
      tzRef.current.value = '';
    }
  }, []);

  // signupAction either redirects on success or returns {error?}. So the
  // success signal is "we submitted AND no error came back". Track the
  // submission with a ref so we don't show the confirmation panel before
  // the user has actually submitted.
  const submittedRef = useRef(false);

  if (submittedRef.current && !state.error && submittedEmail) {
    return (
      <Alert>
        <AlertDescription>
          Check <strong>{submittedEmail}</strong> for a confirmation link to finish creating your
          account. The link expires in 24 hours.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <form
        action={(fd) => {
          submittedRef.current = true;
          setSubmittedEmail(String(fd.get('email') ?? ''));
          formAction(fd);
        }}
        className="space-y-4"
        noValidate
      >
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <input ref={tzRef} type="hidden" name="timezone" />

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
            autoComplete="new-password"
            required
            minLength={8}
            aria-describedby="password-hint"
          />
          <p id="password-hint" className="text-xs text-muted-foreground">
            At least 8 characters.
          </p>
        </div>

        <SubmitButton label="Create account" />
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
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
          Log in
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
