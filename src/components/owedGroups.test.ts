import { describe, expect, it } from "vitest";
import type { Finding } from "@/lib/contracts";
import { closingSoon, groupByKind, sortByUrgency, storeTotals } from "./owedGroups";

const NOW = new Date("2026-10-18T12:00:00Z");

function row(id: string, kind: Finding["kind"], amount: number, dueAt: string | null, merchant = "Grandmart", currency = "USD") {
  return {
    merchant,
    finding: { id, kind, amountAtStake: amount, dueAt, currency } as Finding,
  };
}

const items = [
  row("a", "refund_overdue", 70.35, "2026-10-09T00:00:00Z", "Bazaarly"),
  row("b", "return_deadline", 105.84, "2026-10-20T00:00:00Z", "Northwind"),
  row("c", "return_deadline", 134.22, "2026-10-21T00:00:00Z", "Grandmart"),
  row("d", "price_drop", 40, null, "Northwind"),
  row("e", "refund_short", 4.2, "2026-10-05T00:00:00Z", "Lumen"),
  row("f", "refund_overdue", 10, "2026-10-09T00:00:00Z", "Bazaarly", "CAD"),
];

describe("owedGroups", () => {
  it("groups by kind in a fixed order, one currency, rounded", () => {
    const groups = groupByKind(items, "USD");
    expect(groups.map((g) => g.kind)).toEqual(["return_deadline", "refund_overdue", "price_drop", "refund_short"]);
    expect(groups[0]).toMatchObject({ count: 2, total: 240.06 });
    expect(groups[1]).toMatchObject({ count: 1, total: 70.35 });
  });

  it("sorts upcoming deadlines first, then the most overdue, then undated", () => {
    expect(sortByUrgency(items, NOW).map((i) => i.finding.id)).toEqual(["b", "c", "e", "a", "f", "d"]);
  });

  it("lists only deadlines still ahead, soonest first, up to the limit", () => {
    expect(closingSoon(items, NOW).map((i) => i.finding.id)).toEqual(["b", "c"]);
    expect(closingSoon(items, NOW, 1)).toHaveLength(1);
  });

  it("totals per store, biggest first, ignoring other currencies", () => {
    expect(storeTotals(items, "USD")).toEqual([
      { merchant: "Grandmart", total: 134.22, count: 1 },
      { merchant: "Northwind", total: 145.84, count: 2 },
      { merchant: "Bazaarly", total: 70.35, count: 1 },
      { merchant: "Lumen", total: 4.2, count: 1 },
    ].sort((a, b) => b.total - a.total));
  });
});