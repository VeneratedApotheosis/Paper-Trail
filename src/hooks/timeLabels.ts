// Time labels for the account page and the "Last synced" text in the app shell. `now` is injectable for tests.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago", then the calendar date. A timestamp in the future reads "just now". */
export function relativeTimeLabel(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const elapsed = now.getTime() - then.getTime();
  if (Number.isNaN(elapsed) || elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return `${plural(Math.floor(elapsed / MINUTE_MS), "minute")} ago`;
  if (elapsed < DAY_MS) return `${plural(Math.floor(elapsed / HOUR_MS), "hour")} ago`;
  if (elapsed < 7 * DAY_MS) return `${plural(Math.floor(elapsed / DAY_MS), "day")} ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(then);
}

/** "Oct 18, 2026, 1:02 AM" in the browser's time zone (or `timeZone` when given). */
export function absoluteTimeLabel(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}
