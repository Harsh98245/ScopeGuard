/**
 * @file lib/utils/cn.ts
 * @description Tailwind class merger used by all shadcn/ui components.
 *              Combines clsx (conditional join) with tailwind-merge (last-write-
 *              wins for conflicting utilities so `cn('p-2', isLarge && 'p-4')`
 *              renders only `p-4`).
 */

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind class strings and resolve conflicts.
 *
 * @param inputs - Any combination of strings, arrays, or conditional objects.
 * @returns A single space-separated class string with conflicts resolved.
 *
 * @example
 *   cn('px-2 py-1', error && 'border-red-500', className)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
