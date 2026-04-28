/**
 * @file lib/ai/errors.ts
 * @description Typed error classes thrown by the AI layer. Callers can
 *              `instanceof` against these to decide whether to surface a
 *              friendly retry prompt vs. an actual failure.
 */

/** Base class — every AI-layer error inherits from this. */
export class AIError extends Error {
  /** Original cause when the error wraps another. */
  override readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'AIError';
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * Thrown when {@link import('./parseContract').parseContract} cannot obtain
 * a valid structured payload from Claude after exhausting all retries.
 */
export class ContractParseError extends AIError {
  /** How many attempts ran before giving up. */
  readonly attempts: number;

  constructor(message: string, attempts: number, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'ContractParseError';
    this.attempts = attempts;
  }
}

/**
 * Thrown when {@link import('./checkScope').checkScope} cannot obtain a
 * valid structured payload from Claude after exhausting all retries.
 */
export class ScopeCheckError extends AIError {
  readonly attempts: number;

  constructor(message: string, attempts: number, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'ScopeCheckError';
    this.attempts = attempts;
  }
}
