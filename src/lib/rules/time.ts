/** Date helpers for the rules engine. All math is in fixed 24h UTC periods; no local time zones. */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** `date` plus `days` 24h periods (negative moves backwards). Returns a new Date. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Whole 24h periods from `from` to `to`, truncated toward zero (negative when `to` is earlier). */
export function daysBetween(from: Date, to: Date): number {
  return Math.trunc((to.getTime() - from.getTime()) / DAY_MS);
}

/** UTC calendar date as YYYY-MM-DD. */
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
