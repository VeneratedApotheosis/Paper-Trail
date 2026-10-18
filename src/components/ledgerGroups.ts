import type { NormalizedOrder } from "@/lib/contracts";

// Presentation helpers for the Purchases page: month groups, search and spend per store.
export interface MonthGroup<T> {
  key: string; // YYYY-MM (UTC)
  label: string; // "October 2026"
  items: T[];
}

const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** Groups already-sorted orders by the month they were placed, keeping the given order. */
export function groupByMonth(orders: readonly NormalizedOrder[]): MonthGroup<NormalizedOrder>[] {
  const groups: MonthGroup<NormalizedOrder>[] = [];
  for (const order of orders) {
    const d = new Date(order.placedAt);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(order);
    else groups.push({ key, label: monthLabel.format(d), items: [order] });
  }
  return groups;
}

/** Case-insensitive match on store name and domain. An empty query matches everything. */
export function matchesQuery(order: NormalizedOrder, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${order.merchant.name} ${order.merchant.domain ?? ""}`.toLowerCase().includes(q);
}

export interface StoreSpend {
  merchant: string;
  total: number;
  count: number;
}

/** Spend per store in one currency, biggest first. */
export function spendByStore(orders: readonly NormalizedOrder[], currency: string, limit = 5): StoreSpend[] {
  const totals = new Map<string, StoreSpend>();
  for (const o of orders) {
    if (o.currency !== currency) continue;
    const cur = totals.get(o.merchant.name) ?? { merchant: o.merchant.name, total: 0, count: 0 };
    cur.total = Math.round((cur.total + o.total) * 100) / 100;
    cur.count += 1;
    totals.set(o.merchant.name, cur);
  }
  return [...totals.values()].sort((a, b) => b.total - a.total || a.merchant.localeCompare(b.merchant)).slice(0, limit);
}