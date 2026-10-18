import { describe, expect, it } from "vitest";
import type { NormalizedOrder } from "@/lib/contracts";
import { groupByMonth, matchesQuery, spendByStore } from "./ledgerGroups";

const o = (id: string, placedAt: string, name: string, total: number, currency = "USD", domain: string | null = null) =>
  ({ id, placedAt, total, currency, merchant: { name, domain } }) as unknown as NormalizedOrder;

const orders = [
  o("1", "2026-10-11T10:00:00Z", "FreshCart Grocery", 23.76, "USD", "freshcart.example"),
  o("2", "2026-10-02T10:00:00Z", "Grandmart", 161.29),
  o("3", "2026-09-28T10:00:00Z", "Grandmart", 40),
  o("4", "2026-09-20T10:00:00Z", "Voltline", 56.49, "CAD"),
];

describe("ledgerGroups", () => {
  it("groups sorted orders by month and keeps order", () => {
    const groups = groupByMonth(orders);
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([["October 2026", 2], ["September 2026", 2]]);
  });
  it("matches store name or domain, ignoring case", () => {
    expect(matchesQuery(orders[0], "fresh")).toBe(true);
    expect(matchesQuery(orders[0], "CART.EXAMPLE")).toBe(true);
    expect(matchesQuery(orders[1], "fresh")).toBe(false);
    expect(matchesQuery(orders[1], "  ")).toBe(true);
  });
  it("totals spend per store in one currency, biggest first", () => {
    expect(spendByStore(orders, "USD")).toEqual([
      { merchant: "Grandmart", total: 201.29, count: 2 },
      { merchant: "FreshCart Grocery", total: 23.76, count: 1 },
    ]);
  });
});