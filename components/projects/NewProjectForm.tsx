/**
 * @file components/projects/NewProjectForm.tsx
 * @description Client island for the new-project form. Calls the
 *              createProjectAction server action and renders inline field
 *              errors on validation failure.
 */

'use client';

import { useFormState, useFormStatus } from 'react-dom';

import {
  type ProjectActionResult,
  createProjectAction,
} from '@/app/(dashboard)/projects/actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const initial: ProjectActionResult = {};

export function NewProjectForm() {
  const [state, formAction] = useFormState(createProjectAction, initial);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error && !state.fieldErrors ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <Field
        id="name"
        label="Project name"
        placeholder="Acme Marketing Site"
        error={state.fieldErrors?.name}
        required
      />
      <Field
        id="clientName"
        label="Client name"
        placeholder="Acme Corp"
        error={state.fieldErrors?.clientName}
        required
      />
      <Field
        id="clientEmail"
        label="Client email"
        type="email"
        placeholder="pm@acme.example"
        error={state.fieldErrors?.clientEmail}
        helperText="Optional — used to auto-route forwarded emails to this project."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="hourlyRate"
          label="Hourly rate"
          inputMode="decimal"
          placeholder="125.00"
          error={state.fieldErrors?.hourlyRate}
          helperText="Used for change-order drafts."
        />
        <Field
          id="currency"
          label="Currency"
          placeholder="USD"
          error={state.fieldErrors?.currency}
          maxLength={3}
        />
      </div>

      <SubmitButton />
    </form>
  );
}

interface FieldProps {
  id: string;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  inputMode?: 'decimal' | 'text' | 'email';
  maxLength?: number;
  error?: string;
  helperText?: string;
}

function Field({
  id,
  label,
  type = 'text',
  placeholder,
  required,
  inputMode,
  maxLength,
  error,
  helperText,
}: FieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        type={type}
        {...(placeholder !== undefined ? { placeholder } : {})}
        {...(required ? { required: true } : {})}
        {...(inputMode !== undefined ? { inputMode } : {})}
        {...(maxLength !== undefined ? { maxLength } : {})}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-error` : helperText ? `${id}-help` : undefined}
      />
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : helperText ? (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Creating…' : 'Create project'}
    </Button>
  );
}
