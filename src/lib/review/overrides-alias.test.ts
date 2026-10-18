import { describe, expect, it } from "vitest";
import { DEDUP_SPECS, extractionOf, rawEmailOf } from "@/lib/orders/dedup/dedup-fixtures";
import { matchOrders } from "@/lib/orders/matcher";
import { applyOverrides } from "./overrides";
import type { OverrideRecord } from "./override-store";
import { resultOf } from "@/lib/pipeline/accounts.fixtures";

// Review corrections saved under an order id that dedup later merged away still apply (#126 + #124).
const spec = (id: string) => DEDUP_SPECS.find((candidate) => candidate.id === id)!;
const input = (id: string) => ({ email: rawEmailOf(spec(id)), extraction: extractionOf(spec(id)) });
const NOW = new Date("2026-11-01T00:00:00Z");

describe("applyOverrides with aliasIds", () => {
  const OLD_ID = "order:amazon-marketplace:112-1234567-1234567";
  const [order] = matchOrders([input("amz-order"), input("amz-ship")]);

  it("sanity: the merged order lists the old id as an alias and keeps the earliest email's id", () => {
    expect(order.id).toBe("order:amazon-com:112-1234567-1234567");
    expect(order.aliasIds).toEqual([OLD_ID]);
  });

  it("re-keys an edit and a confirm saved under the old id (and its line item ids) to the merged order", () => {
    const result = { ...resultOf([]), orders: [order] };
    const lineItemId = order.lineItems[0].id;
    const records: OverrideRecord[] = [
      { kind: "edit", orderId: OLD_ID, edit: { field: "total", value: 55 }, at: "2026-10-30T10:00:00.000Z" },
      { kind: "edit", orderId: OLD_ID, edit: { field: "lineItemName", lineItemId: lineItemId.replace(order.id, OLD_ID), value: "Desk Lamp (corrected)" }, at: "2026-10-30T10:01:00.000Z" },
      { kind: "confirm", orderId: OLD_ID, confirmedAt: "2026-10-30T10:02:00.000Z", at: "2026-10-30T10:02:00.000Z" },
    ];
    const { result: applied, report } = applyOverrides(result, records, { now: NOW });
    expect(report.orphaned).toBe(0);
    expect(report.applied).toBe(3);
    const corrected = applied.orders[0];
    expect(corrected.total).toBe(55);
    expect(corrected.lineItems[0].name).toBe("Desk Lamp (corrected)");
    expect(corrected.needsReview).toBe(false);
    expect(corrected.review?.correctedFields).toEqual(["lineItemName", "total"]);
  });

  it("an edit saved under the order's own id wins over one saved under an alias", () => {
    const result = { ...resultOf([]), orders: [order] };
    const records: OverrideRecord[] = [
      { kind: "edit", orderId: order.id, edit: { field: "total", value: 70 }, at: "2026-10-30T10:00:00.000Z" },
      { kind: "edit", orderId: OLD_ID, edit: { field: "total", value: 55 }, at: "2026-10-31T10:00:00.000Z" },
    ];
    expect(applyOverrides(result, records, { now: NOW }).result.orders[0].total).toBe(70);
  });

  it("records for ids that belong to no order stay orphaned", () => {
    const result = { ...resultOf([]), orders: [order] };
    const records: OverrideRecord[] = [{ kind: "edit", orderId: "order:other:1", edit: { field: "total", value: 1 }, at: "2026-10-30T10:00:00.000Z" }];
    expect(applyOverrides(result, records, { now: NOW }).report).toEqual({ applied: 0, orphaned: 1 });
  });
});
