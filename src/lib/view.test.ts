import { describe, expect, it } from "vitest";
import { orders, findings } from "@/lib/mock/data";
import { computeOwedSummary, deriveOrderStatus, findingCountsTowardOwed, orderNeedsReview } from "@/lib/view";

describe("deriveOrderStatus", () => {
  it("returns 'ordered' when there are no events", () => {
    const atlas = orders.find((o) => o.id === "ord_1004")!;
    expect(deriveOrderStatus(atlas)).toBe("ordered");
  });

  it("uses the latest event to derive status", () => {
    const fieldNotes = orders.find((o) => o.id === "ord_1003")!;
    expect(deriveOrderStatus(fieldNotes)).toBe("refunded");
  });
});

describe("orderNeedsReview", () => {
  it("flags orders below the confidence threshold", () => {
    const atlas = orders.find((o) => o.id === "ord_1004")!;
    expect(orderNeedsReview(atlas)).toBe(true);
  });

  it("does not flag high-confidence orders", () => {
    const rowan = orders.find((o) => o.id === "ord_1001")!;
    expect(orderNeedsReview(rowan)).toBe(false);
  });
});

describe("computeOwedSummary", () => {
  it("excludes findings on needs-review orders from the owed total", () => {
    const summary = computeOwedSummary(findings, orders);
    // All four demo findings are on reviewed orders, so all count.
    expect(summary.findingCount).toBe(4);
    expect(summary.owedTotal).toBeCloseTo(98 + 89 + 26 + 20, 2);
  });

  it("holds out findings whose order needs review", () => {
    const extra = {
      ...findings[0],
      id: "refund_overdue:ord_1004",
      orderId: "ord_1004",
      amountAtStake: 50,
    };
    const summary = computeOwedSummary([...findings, extra], orders);
    expect(summary.excludedCount).toBe(1);
    expect(summary.excludedTotal).toBeCloseTo(50, 2);
  });

  it("keeps approved (drafted) claims in the owed total until resolved (#77 Option A)", () => {
    const rowan = orders.find((o) => o.id === "ord_1001")!;
    const drafted = { ...findings[0], orderId: rowan.id, status: "drafted" as const };
    expect(findingCountsTowardOwed(drafted, rowan)).toBe(true);
    expect(findingCountsTowardOwed({ ...drafted, status: "resolved" }, rowan)).toBe(false);

    const open = computeOwedSummary(findings, orders);
    const withDraft = computeOwedSummary([drafted, ...findings.slice(1)], orders);
    expect(withDraft.owedTotal).toBe(open.owedTotal);
    expect(withDraft).toMatchObject({ claimSentCount: 1, claimSentTotal: drafted.amountAtStake });
  });
});
