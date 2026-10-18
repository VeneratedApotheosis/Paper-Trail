import { beforeEach, describe, expect, it } from "vitest";
import { matchOrders } from "@/lib/orders/matcher";
import { trackingInputs } from "@/lib/orders/tracking-fixtures";
import type { PipelineResult } from "@/lib/pipeline/run";
import { getOrder, resetStore, setPipelineResult } from "@/lib/store";
import { buildLedgerResponse } from "./ledger";
import { deriveOrderStatus } from "@/lib/view";

beforeEach(() => resetStore());

describe("purchase kinds on the ledger API (#127)", () => {
  it("serves kind, details and packageOnly as built, with no money for the package entry", () => {
    const orders = matchOrders(trackingInputs("bkb-confirmed", "bkb-shipped", "bkb-out", "pkg-shipped", "pkg-out"));
    const result: PipelineResult = {
      orders, findings: [], reviewQueue: [],
      stats: { emails: 5, prefilteredOut: 0, classes: {}, extracted: 5, skipped: 0, extractionOrigins: { llm: 0, cache: 0, gold: 5 }, orders: orders.length, excludedOrders: 0, findings: 0, needsReview: 0 },
    };
    setPipelineResult("demo", "2026-10-17T00:00:00.000Z", result);
    const ledger = buildLedgerResponse();
    expect(ledger.orders.map((order) => [order.kind, order.packageOnly ?? false]).sort()).toEqual([["shipped", false], ["shipped", true]]);
    const [receipt] = ledger.orders.filter((order) => !order.packageOnly);
    expect(receipt.details).toMatchObject({ kind: "shipped", shipments: [{ trackingNumber: "1Z999AA10123456784", status: "out_for_delivery" }] });
    expect(getOrder(receipt.id)?.details).toEqual(receipt.details);
    expect(ledger.summary).toMatchObject({ owedTotal: 0, findingCount: 0, excludedCount: 0 });
    expect(deriveOrderStatus(receipt)).toBe("shipped");
  });
});
