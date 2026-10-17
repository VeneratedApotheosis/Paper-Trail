// Formatting helpers shared across the UI. Keep money/date formatting here so
// every screen renders amounts and dates identically.
import { REVIEW_CONFIDENCE_THRESHOLD } from "@/lib/contracts";

// Re-export the canonical threshold (defined in contracts) under a short name.
export const CONFIDENCE_THRESHOLD = REVIEW_CONFIDENCE_THRESHOLD;

export function formatMoney(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

export function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

// Whole days from `now` until `iso` (negative = overdue). `now` is injectable
// so UI stays deterministic in tests and demos.
export function daysUntil(iso: string, now: Date = new Date()): number {
  const ms = new Date(iso).getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

// Human countdown for deadline chips: "2 days left", "due today", "14 days overdue".
export function countdownLabel(iso: string, now: Date = new Date()): string {
  const d = daysUntil(iso, now);
  if (d === 0) return "due today";
  if (d > 0) return `${d} day${d === 1 ? "" : "s"} left`;
  const overdue = Math.abs(d);
  return `${overdue} day${overdue === 1 ? "" : "s"} overdue`;
}

export function isNeedsReview(confMin: number): boolean {
  return confMin < CONFIDENCE_THRESHOLD;
}

export function confidencePercent(conf: number): string {
  return `${Math.round(conf * 100)}%`;
}
