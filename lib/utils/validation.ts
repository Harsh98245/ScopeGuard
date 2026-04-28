/**
 * @file lib/utils/validation.ts
 * @description Shared Zod schemas + a single helper for validating API route
 *              request bodies. Returns a structured 400 response on failure
 *              so the client always receives the same error shape.
 *
 * @author ScopeGuard
 * @lastModified 2026-04-27
 */

import { NextResponse } from 'next/server';
import { ZodError, type ZodSchema, z } from 'zod';

/** Standard error envelope returned by every API route on validation failure. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
  };
}

/**
 * Parse a Request body as JSON and validate it against a Zod schema.
 *
 * @param request - The incoming Request from a Next.js route handler.
 * @param schema - The expected body schema.
 * @returns `{ ok: true, data }` on success or `{ ok: false, response }` with
 *          a ready-to-return 400 NextResponse on failure.
 *
 * @example
 *   const result = await parseJsonBody(req, CreateProjectSchema);
 *   if (!result.ok) return result.response;
 *   const project = await prisma.project.create({ data: result.data });
 */
export async function parseJsonBody<T>(
  request: Request,
  schema: ZodSchema<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse<ApiErrorBody> }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json<ApiErrorBody>(
        { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } },
        { status: 400 },
      ),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json<ApiErrorBody>(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Request body failed schema validation.',
            fields: flattenZodError(parsed.error),
          },
        },
        { status: 400 },
      ),
    };
  }

  return { ok: true, data: parsed.data };
}

/**
 * Flatten Zod issues into `{ fieldPath: [messages] }` for the API error envelope.
 */
function flattenZodError(err: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_root';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

// ---------- Reusable primitives -------------------------------------------

/** ISO 4217 currency code (3 uppercase letters). */
export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, 'Must be 3-letter ISO 4217 code.');

/** UUID v4-ish — accepts any RFC 4122 UUID. */
export const UuidSchema = z.string().uuid();

/** Positive money amount as a decimal string with up to 2 fractional digits. */
export const MoneyStringSchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Must be a positive decimal with up to 2 fractional digits.');

/** Email address — uses Zod's built-in regex which is conservative. */
export const EmailSchema = z.string().email().toLowerCase().trim();

/** IANA timezone string. We don't validate against the full tz database here;
 *  invalid values throw at format time. */
export const TimezoneSchema = z.string().min(1).max(64);
