import { beforeEach, describe, expect, it } from "vitest";
import { findings, orders } from "@/lib/mock/data";
import type { PipelineResult } from "@/lib/pipeline/run";
import { resetStore, setPipelineResult } from "@/lib/store";
import { buildLedgerResponse } from "./ledger";

const stats: PipelineResult["stats"] = {
  emails: 2,
  prefilteredOut: 0,
  classes: { order: 2 },
  extracted: 2,
  skipped: 0,
  extractionOrigins: { llm: 0, cache: 0, gold: 2 },
  orders: 1,
  excludedOrders: 0,
  findings: 2,
  needsReview: 0,
};

beforeEach(() => resetStore());

describe("buildLedgerResponse", () => {
  it("rounds money totals to cents instead of exposing floating-point noise", () => {
    const order = { ...orders[0], confMin: 1, needsReview: false };
    const result: PipelineResult = {
      orders: [order],
      findings: [
        { ...findings[0], id: "float-1", orderId: order.id, amountAtStake: 0.1 },
        { ...findings[0], id: "float-2", orderId: order.id, amountAtStake: 0.2 },
      ],
      reviewQueue: [],
      stats,
    };

    setPipelineResult("demo", "2026-10-17T00:00:00.000Z", result);

    expect(buildLedgerResponse().summary).toMatchObject({ owedTotal: 0.3, excludedTotal: 0 });
  });

  it("serves the rules owed summary: drafted claims count and are reported as claim sent (#77)", () => {
    const order = { ...orders[0], confMin: 1, needsReview: false };
    const result: PipelineResult = {
      orders: [order],
      findings: [
        { ...findings[0], id: "open-1", orderId: order.id, amountAtStake: 0.1 },
        { ...findings[0], id: "sent-1", orderId: order.id, amountAtStake: 0.2, status: "drafted" },
        { ...findings[0], id: "sent-2", orderId: order.id, amountAtStake: 0.1, status: "drafted" },
        { ...findings[0], id: "done-1", orderId: order.id, amountAtStake: 5, status: "resolved" },
      ],
      reviewQueue: [],
      stats,
    };

    setPipelineResult("demo", "2026-10-17T00:00:00.000Z", result);

    expect(buildLedgerResponse().summary).toEqual({
      currency: "USD",
      owedTotal: 0.4,
      findingCount: 3,
      claimSentCount: 2,
      claimSentTotal: 0.3,
      excludedCount: 0,
      excludedTotal: 0,
    });
  });
});
