import { describe, expect, it } from "vitest";
import { NormalizedOrderSchema, type NormalizedOrder } from "@/lib/contracts";
import { mergeSameOrder } from "./merge";

const POLICY = { returnWindowDays: null, windowAnchor: null, refundSlaDays: null, priceAdjustDays: null, policySource: null,
  policyQuote: null, nonReturnable: false } as const;

function order(overrides: Partial<NormalizedOrder> = {}): NormalizedOrder {
  return NormalizedOrderSchema.parse({
    id: "order:northwind:nw-1001", merchant: { name: "Northwind", domain: "northwind.example", policy: POLICY }, orderRef: "NW-1001",
    placedAt: "2026-09-01T10:00:00.000Z", currency: "USD", subtotal: null, tax: null, shipping: null, discount: null, total: 80,
    last4: null, customerName: null,
    lineItems: [{ id: "order:northwind:nw-1001:li:a", name: "Jacket", sku: "A", qty: 1, unitPrice: 80, returnedQty: 0 }],
    events: [], messageIds: ["m1"], confMin: 0.95, needsReview: false, sources: ["acct-a"], ...overrides,
  });
}
const event = (id: string, type: "shipped" | "return_received", at: string, messageId: string) => ({ id, type, at, messageId, conf: 0.9 });

describe("mergeSameOrder", () => {
  it("returns a lone order unchanged", () => {
    const only = order();
    expect(mergeSameOrder([only])).toBe(only);
    expect(() => mergeSameOrder([])).toThrow();
  });

  it("unions sources, messages and events and counts a duplicated event once", () => {
    const a = order({ messageIds: ["a1", "a2"], sources: ["acct-a"],
      events: [event("e1", "shipped", "2026-09-02T09:00:00.000Z", "a2")] });
    const b = order({ messageIds: ["b1", "b2"], sources: ["acct-b"], events: [
      event("e2", "shipped", "2026-09-02T09:30:00.000Z", "b2"), event("e3", "return_received", "2026-09-09T09:00:00.000Z", "b2")] });
    const merged = mergeSameOrder([b, a]);
    expect(merged.sources).toEqual(["acct-a", "acct-b"]);
    expect([...merged.messageIds].sort()).toEqual(["a1", "a2", "b1", "b2"]);
    expect(merged.events.map(item => item.type)).toEqual(["shipped", "return_received"]);
    expect(merged).toEqual(mergeSameOrder([a, b]));
    expect(NormalizedOrderSchema.parse(merged)).toEqual(merged);
  });

  it("takes amounts from the confirmed copy, fills missing facts from the others, and drops the review state", () => {
    const confirmed = order({ sources: ["acct-a"], total: 80, last4: null, review: { revision: crypto.randomUUID() },
      merchant: { name: "Northwind", domain: "northwind.example", policy: { ...POLICY, refundSlaDays: 7, policySource: "email_text" } } });
    const bare = order({ sources: ["acct-b"], needsReview: true, confMin: 0.6, total: 0, last4: "4242", lineItems: [],
      merchant: { name: "Northwind", domain: null, policy: { ...POLICY, returnWindowDays: 30, nonReturnable: true } } });
    const merged = mergeSameOrder([bare, confirmed]);
    expect(merged.total).toBe(80);
    expect(merged.last4).toBe("4242");
    expect(merged.lineItems).toHaveLength(1);
    expect(merged.merchant.policy).toMatchObject({ refundSlaDays: 7, returnWindowDays: 30, nonReturnable: true });
    expect(merged.confMin).toBe(0.6);
    expect(merged.needsReview).toBe(true); // a copy with low confidence still needs a human
    expect(merged.review).toBeUndefined();
  });

  it("keeps the larger returned quantity per line item", () => {
    const item = order().lineItems[0];
    const merged = mergeSameOrder([order({ lineItems: [{ ...item, qty: 2, returnedQty: 1 }] }), order({ sources: ["acct-b"], lineItems: [{ ...item, qty: 2, returnedQty: 2 }] })]);
    expect(merged.lineItems).toEqual([{ ...item, qty: 2, returnedQty: 2 }]);
  });

  it("merges a package-only entry into the real order: shipments joined, flag gone, amounts from the receipt (#127)", () => {
    const shipment = (status: "shipped" | "delivered") => ({ carrier: "UPS", trackingNumber: "1Z999AA10123456784", trackingUrl: null, status, eta: null, shippedAt: "2026-09-02T09:00:00.000Z", deliveredAt: status === "delivered" ? "2026-09-04T09:00:00.000Z" : null, itemIds: [] });
    const receipt = order({ kind: "shipped", details: { kind: "shipped", shipments: [shipment("shipped")] } });
    const pkg = order({ id: "order:ups:pkg-1z", orderRef: null, total: 0, lineItems: [], packageOnly: true, kind: "shipped", messageIds: ["p1"], sources: ["acct-b"],
      details: { kind: "shipped", shipments: [shipment("delivered")] }, events: [event("e9", "shipped", "2026-09-02T09:00:00.000Z", "p1")] });
    const merged = mergeSameOrder([pkg, receipt]);
    expect(merged).toMatchObject({ id: receipt.id, total: 80, kind: "shipped" });
    expect(merged.packageOnly).toBeUndefined();
    expect(merged.details).toMatchObject({ kind: "shipped", shipments: [{ trackingNumber: "1Z999AA10123456784", status: "delivered", deliveredAt: "2026-09-04T09:00:00.000Z" }] });
    expect(merged.aliasIds).toContain("order:ups:pkg-1z");
    expect(mergeSameOrder([receipt, pkg])).toEqual(merged);
    expect(mergeSameOrder([pkg, { ...pkg, id: "order:ups:pkg-1z:2", sources: ["acct-c"] }]).packageOnly).toBe(true);
  });
});
