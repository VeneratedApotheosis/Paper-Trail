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

// Plain-language reading of an extraction confidence (0..1). Never an odds-of-payout
// figure: it only says how sure we are we read the email correctly (#106).
export type ConfidenceLevel = "clear" | "probably_right" | "needs_check";

const CLEAR_CONFIDENCE = 0.9;

export function confidenceLevel(conf: number): ConfidenceLevel {
  if (isNeedsReview(conf)) return "needs_check";
  return conf >= CLEAR_CONFIDENCE ? "clear" : "probably_right";
}

const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  clear: "Clear",
  probably_right: "Probably right",
  needs_check: "Needs a quick check",
};

// ">= 90%": "Clear", 70-89%: "Probably right", below 70%: "Needs a quick check".
export function confidenceLabel(conf: number): string {
  return CONFIDENCE_LABELS[confidenceLevel(conf)];
}
