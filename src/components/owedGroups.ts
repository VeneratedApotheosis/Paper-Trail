import type { Finding, FindingKind } from "@/lib/contracts";
import { daysUntil } from "@/lib/format";

// Presentation helpers for the Owed page. They only regroup, order and add up
// the findings the page already receives; the owed total itself still comes
// from the backend summary. `now` is a parameter so tests need no fake clock.
export interface OwedRowLike {
  finding: Finding;
  merchant: string;
}

export const KIND_LABELS: Record<FindingKind, string> = {
  refund_overdue: "Refund overdue",
  refund_short: "Refund came up short",
  return_deadline: "Return window closing",
  price_drop: "Price dropped",
  rewards_gap: "Rewards missed",
};

// Plural names for the legend and filter tabs.
export const KIND_GROUP_LABELS: Record<FindingKind, string> = {
  return_deadline: "Return windows",
  refund_overdue: "Overdue refunds",
  price_drop: "Price drops",
  refund_short: "Short refunds",
  rewards_gap: "Rewards",
};

export const KIND_ORDER: FindingKind[] = ["return_deadline", "refund_overdue", "price_drop", "refund_short", "rewards_gap"];

export interface KindGroup {
  kind: FindingKind;
  label: string;
  count: number;
  total: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Counts and amounts per rule kind, in a fixed order, in one currency (no conversion). */
export function groupByKind<T extends OwedRowLike>(items: readonly T[], currency: string): KindGroup[] {
  const groups = new Map<FindingKind, KindGroup>();
  for (const { finding } of items) {
    if (finding.currency !== currency) continue;
    const current = groups.get(finding.kind) ?? { kind: finding.kind, label: KIND_GROUP_LABELS[finding.kind], count: 0, total: 0 };
    current.count += 1;
    current.total = round2(current.total + finding.amountAtStake);
    groups.set(finding.kind, current);
  }
  return KIND_ORDER.flatMap((kind) => {
    const group = groups.get(kind);
    return group ? [group] : [];
  });
}

/** What closes first: upcoming deadlines (soonest first), then overdue (most overdue first), then no date. */
export function sortByUrgency<T extends OwedRowLike>(items: readonly T[], now: Date = new Date()): T[] {
  const rank = (item: T): [number, number] => {
    const { dueAt } = item.finding;
    if (!dueAt) return [2, 0];
    const days = daysUntil(dueAt, now);
    return days >= 0 ? [0, days] : [1, days];
  };
  return [...items].sort((a, b) => {
    const [ga, da] = rank(a);
    const [gb, db] = rank(b);
    return ga - gb || da - db;
  });
}

/** Findings with a deadline still ahead, soonest first. */
export function closingSoon<T extends OwedRowLike>(items: readonly T[], now: Date = new Date(), limit = 4): T[] {
  return sortByUrgency(items, now)
    .filter(({ finding }) => finding.dueAt !== null && daysUntil(finding.dueAt, now) >= 0)
    .slice(0, limit);
}

export interface StoreTotal {
  merchant: string;
  total: number;
  count: number;
}

/** Amount at stake per store, biggest first, in one currency. */
export function storeTotals<T extends OwedRowLike>(items: readonly T[], currency: string, limit = 5): StoreTotal[] {
  const totals = new Map<string, StoreTotal>();
  for (const { finding, merchant } of items) {
    if (finding.currency !== currency) continue;
    const current = totals.get(merchant) ?? { merchant, total: 0, count: 0 };
    current.total = round2(current.total + finding.amountAtStake);
    current.count += 1;
    totals.set(merchant, current);
  }
  return [...totals.values()].sort((a, b) => b.total - a.total || a.merchant.localeCompare(b.merchant)).slice(0, limit);
}