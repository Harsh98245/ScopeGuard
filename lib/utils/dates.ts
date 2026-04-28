/**
 * @file lib/utils/dates.ts
 * @description Timezone-aware date helpers. The user's IANA timezone is stored
 *              on `User.timezone` and threaded through these helpers so all UI
 *              renders dates in the user's local time, not the server's.
 *
 * @author ScopeGuard
 * @lastModified 2026-04-27
 */

import { format } from 'date-fns';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';

/**
 * Format a Date for display in the user's timezone.
 *
 * @param date - Source Date (UTC instant).
 * @param timezone - IANA tz, e.g. "America/Toronto". See User.timezone.
 * @param pattern - date-fns pattern. Defaults to a friendly long form.
 * @returns Formatted string.
 *
 * @example
 *   formatDateInTz(scopeCheck.createdAt, user.timezone) // "Apr 27, 2026, 3:14 PM"
 */
export function formatDateInTz(
  date: Date,
  timezone: string,
  pattern: string = 'PPp',
): string {
  return formatInTimeZone(date, timezone, pattern);
}

/**
 * Convert a UTC Date to the equivalent wall-clock instant in the user's zone.
 * Useful when feeding a Date into a chart library that ignores timezones.
 *
 * @param date - UTC instant.
 * @param timezone - IANA tz.
 * @returns Date object whose getHours()/getDate() return the local values.
 */
export function toUserZone(date: Date, timezone: string): Date {
  return toZonedTime(date, timezone);
}

/**
 * Compute the [start, end] UTC instants of the calendar quarter containing
 * `date` in the user's timezone. Used by the tax estimator to bucket YTD
 * income.
 *
 * @param date - Reference instant.
 * @param timezone - IANA tz.
 * @returns Tuple of UTC Dates marking quarter boundaries.
 */
export function quarterBounds(date: Date, timezone: string): [Date, Date] {
  const local = toZonedTime(date, timezone);
  const month = local.getMonth();
  const quarterStartMonth = Math.floor(month / 3) * 3;
  const year = local.getFullYear();

  const startLocal = new Date(year, quarterStartMonth, 1, 0, 0, 0);
  const endLocal = new Date(year, quarterStartMonth + 3, 1, 0, 0, 0);
  return [startLocal, endLocal];
}

/**
 * Return the quarter index (1..4) of the given date in the user's zone.
 */
export function quarterOf(date: Date, timezone: string): 1 | 2 | 3 | 4 {
  const local = toZonedTime(date, timezone);
  const q = (Math.floor(local.getMonth() / 3) + 1) as 1 | 2 | 3 | 4;
  return q;
}

/**
 * Render an ISO date (YYYY-MM-DD) for inputs and machine-readable surfaces.
 */
export function toIsoDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}
