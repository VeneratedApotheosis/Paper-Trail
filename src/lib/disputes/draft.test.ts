import { describe, expect, it } from "vitest";
import { makeOrder } from "@/lib/rules/test-helpers";
import { refundOverdueFixture } from "@/lib/claims/test-fixtures";
import { draftDispute } from "./draft";

describe("dispute drafts", () => {
  it("uses order facts and explicitly confirmed nonreceipt without asserting eligibility", () => {
    const order = refundOverdueFixture().order;
    const before = structuredClone(order);
    const result = draftDispute(order, { reason: "item_not_received", confirmed: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.body).toContain(order.orderRef);
    expect(result.draft.body).toContain("I have not received");
    expect(result.draft.warnings.some(warning => warning.includes("delivery notice"))).toBe(true);
    expect(result.draft.requiresApproval).toBe(true);
    expect(result.draft).not.toHaveProperty("mailtoUrl");
    expect(result.draft.body).not.toMatch(/chargeback|guaranteed|\$113/);
    expect(order).toEqual(before);
  });
  it("describes only the selected ordered item and user-reported replacement", () => {
    const order = makeOrder();
    const result = draftDispute(order, { reason: "wrong_item", confirmed: true, lineItemId: order.lineItems[0].id, receivedItem: "Synthetic blue mug" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.body).toContain(order.lineItems[0].name);
    expect(result.draft.body).toContain("Synthetic blue mug");
    expect(result.draft.subject).toContain("Wrong item received");
    expect(draftDispute(order, { reason: "wrong_item", confirmed: true, lineItemId: "other-order-item", receivedItem: "Mug" })).toMatchObject({ ok: false, reason: "unknown_item" });
  });
  it.each([
    { reason: "item_not_received" }, { reason: "item_not_received", confirmed: false },
    { reason: "wrong_item", confirmed: true }, { reason: "unsupported", confirmed: true },
    { reason: "item_not_received", confirmed: true, amount: 999 },
  ])("rejects missing confirmation, unsupported scenarios and invented input fields", request => {
    expect(draftDispute(makeOrder(), request)).toMatchObject({ ok: false, reason: "invalid_request" });
  });
  it("uses Customer for missing/tokenized names and date for a missing order reference", () => {
    for (const customerName of [null, "[NAME_1]"]) {
      const result = draftDispute(makeOrder({ customerName, orderRef: null, needsReview: true }), { reason: "item_not_received", confirmed: true });
      if (!result.ok) throw new Error(result.message);
      expect(result.draft.signedName).toBe("Customer");
      expect(result.draft.subject).toContain("purchase placed on");
      expect(result.draft.warnings.some(warning => warning.includes("still needs review"))).toBe(true);
    }
  });
});
