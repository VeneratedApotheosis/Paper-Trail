import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { makeOrder, makeEvent } from "@/lib/rules/test-helpers";
import { defaultRules, runRules } from "@/lib/rules";
import { getOrder, getState, resetStore, setPipelineResult, setFindingStatus, upsertDraft, excludeMerchant, withStoreScope, clearLedger } from "@/lib/store";
import { buildLedgerResponse } from "@/lib/api/ledger";
import { orderNeedsReview } from "@/lib/view";
import { seedPriceFeed } from "@/lib/demo/seed";
import { confirmReviewedOrder, editReviewedOrder } from "./service";
import { EditRequestSchema } from "./schema";
import type { NormalizedOrder } from "@/lib/contracts";

const now = new Date("2026-10-17T12:00:00.000Z");
export function loadReviewFixture(orders?: NormalizedOrder[]) {
  const list = orders ?? [makeOrder({ confMin: 0.5, needsReview: true, events: [
    makeEvent("return_received", "2026-09-10T10:00:00.000Z", { evidence: "Return received for the synthetic order", conf: 0.5 }),
  ] })];
  setPipelineResult("upload", now.toISOString(), { orders: list, findings: runRules(list, defaultRules, { now }),
    reviewQueue: [{ emailId: "msg-order", orderId: list[0].id, stage: "match", reason: "low confidence" },
      { emailId: "unmatched-mail", stage: "extract", reason: "needs extraction" }],
    stats: { emails: 2, prefilteredOut: 0, classes: { order: 1 }, extracted: 1, skipped: 0,
      extractionOrigins: { llm: 1, cache: 0, gold: 0 }, orders: list.length, excludedOrders: 0, findings: 0, needsReview: 2 },
  });
  return getOrder(list[0].id)!;
}
beforeEach(() => resetStore());
describe("human review", () => {
  it.each(["open", "drafted", "resolved", "dismissed"] as const)(
    "preserves %s through repeated edits and confirmation while recomputing amounts", status => {
      const original = loadReviewFixture();
      const first = confirmReviewedOrder(original.id, original.review!.revision, now);
      const finding = first.findings[0];
      setFindingStatus(finding.id, status);
      const edited = editReviewedOrder(original.id, first.revision, { field: "total", value: 40 }, now);
      const again = editReviewedOrder(original.id, edited.revision, { field: "orderRef", value: "SYNTHETIC-CORRECTION" }, now);
      expect(getState().findings).toEqual([]);
      expect(buildLedgerResponse().summary.owedTotal).toBe(0);
      const confirmed = confirmReviewedOrder(original.id, again.revision, now);
      const rebuilt = confirmed.findings.find(item => item.id === finding.id)!;
      expect(rebuilt.status).toBe(status);
      expect(rebuilt.amountAtStake).toBeLessThan(finding.amountAtStake);
      expect(getState().findings).toContainEqual(rebuilt);
      expect(buildLedgerResponse().summary.owedTotal).toBe(status === "open" || status === "drafted" ? rebuilt.amountAtStake : 0);
      expect(confirmReviewedOrder(original.id, confirmed.revision, now)).toEqual(confirmed);
    },
  );
  it("keeps existing statuses on direct confirmation after a replacement snapshot", () => {
    const original = loadReviewFixture();
    const first = confirmReviewedOrder(original.id, original.review!.revision, now);
    setFindingStatus(first.findings[0].id, "resolved");
    const state = getState();
    // A new source snapshot may contain findings alongside an order needing review.
    setPipelineResult("upload", now.toISOString(), { orders: [{ ...first.order, needsReview: true }],
      findings: state.findings, reviewQueue: [], stats: state.stats! });
    const order = getOrder(original.id)!;
    const confirmed = confirmReviewedOrder(order.id, order.review!.revision, now);
    expect(confirmed.findings[0].status).toBe("resolved");
  });
  it.each([resetStore, clearLedger])("does not restore pending status history after reset (%#)", reset => {
    const original = loadReviewFixture();
    const first = confirmReviewedOrder(original.id, original.review!.revision, now);
    setFindingStatus(first.findings[0].id, "dismissed");
    editReviewedOrder(original.id, first.revision, { field: "total", value: 40 }, now);
    reset();
    const replacement = loadReviewFixture();
    const next = confirmReviewedOrder(replacement.id, replacement.review!.revision, now);
    expect(next.findings[0].id).toBe(first.findings[0].id);
    expect(next.findings[0].status).toBe("open");
  });
  it("does not carry a disappeared finding's status into a new review cycle", () => {
    const original = loadReviewFixture();
    const first = confirmReviewedOrder(original.id, original.review!.revision, now);
    setFindingStatus(first.findings[0].id, "resolved");
    const edited = editReviewedOrder(original.id, first.revision, { field: "total", value: 40 }, now);
    // Inject a clock before the refund deadline so the deterministic rule no
    // longer produces this finding, then advance it for the next review cycle.
    expect(confirmReviewedOrder(original.id, edited.revision, new Date("2026-09-11T12:00:00Z")).findings).toEqual([]);
    const changed = editReviewedOrder(original.id, edited.revision, { field: "total", value: 100 }, now);
    expect(confirmReviewedOrder(original.id, changed.revision, now).findings[0].status).toBe("open");
  });
  it("isolates pending finding statuses for accounts with identical order/finding IDs", () => {
    const prepare = (scope: string, status: "drafted" | "resolved") => withStoreScope(scope, () => {
      resetStore();
      const order = loadReviewFixture();
      const confirmed = confirmReviewedOrder(order.id, order.review!.revision, now);
      setFindingStatus(confirmed.findings[0].id, status);
      return editReviewedOrder(order.id, confirmed.revision, { field: "total", value: 40 }, now);
    });
    const first = prepare("first", "resolved"), second = prepare("second", "drafted");
    expect(withStoreScope("second", () => confirmReviewedOrder(second.order.id, second.revision, now).findings[0].status)).toBe("drafted");
    expect(withStoreScope("first", () => confirmReviewedOrder(first.order.id, first.revision, now).findings[0].status)).toBe("resolved");
  });
  it("keeps edits out of totals until confirmation without inflating model confidence", () => {
    const original = loadReviewFixture();
    const edited = editReviewedOrder(original.id, original.review!.revision, { field: "lineItemUnitPrice", lineItemId: "li-jacket", value: 90 }, now);
    expect(edited.order.needsReview).toBe(true);
    expect(edited.order.review?.confirmedAt).toBeUndefined();
    expect(edited.revision).not.toBe(original.review!.revision);
    expect(buildLedgerResponse().summary.owedTotal).toBe(0);
    const confirmed = confirmReviewedOrder(original.id, edited.revision, now);
    expect(confirmed.order.confMin).toBe(0.5);
    expect(confirmed.order.events).toEqual(original.events);
    expect(confirmed.order.review?.confirmedAt).toBe(now.toISOString());
    expect(orderNeedsReview(confirmed.order)).toBe(false);
    expect(confirmed.findings.length).toBeGreaterThan(0);
    expect(buildLedgerResponse().summary.owedTotal).toBeGreaterThan(0);
    expect(getState().reviewQueue).toEqual([{ emailId: "unmatched-mail", stage: "extract", reason: "needs extraction" }]);
    expect(getState().stats?.needsReview).toBe(1);
    expect(getState().audit.map(a => a.detail)).toEqual([
      expect.stringContaining("Review confirmed:"), expect.stringContaining("Review edit saved:"),
    ]);
  });
  it("reconfirms only after edits and discards drafts with stale amounts", () => {
    const original = loadReviewFixture();
    const confirmed = confirmReviewedOrder(original.id, original.review!.revision, now);
    const finding = confirmed.findings[0];
    upsertDraft({ id: "draft1", findingId: finding.id, subject: "old", body: "old amount", recipient: "support@synthetic.example", signedName: "Synthetic" });
    const edited = editReviewedOrder(original.id, confirmed.revision, { field: "total", value: 40 }, now);
    expect(getState().drafts).toEqual([]);
    expect(getState().findings).toEqual([]);
    expect(buildLedgerResponse().summary.owedTotal).toBe(0);
    const next = confirmReviewedOrder(original.id, edited.revision, now);
    expect(next.findings[0].amountAtStake).toBeLessThan(finding.amountAtStake);
  });
  it("rejects stale forms after an edit and after a replacement sync", () => {
    const original = loadReviewFixture();
    const changed = editReviewedOrder(original.id, original.review!.revision, { field: "total", value: 100 }, now);
    expect(() => confirmReviewedOrder(original.id, original.review!.revision, now)).toThrow("Order changed");
    expect(getOrder(original.id)?.review?.revision).toBe(changed.revision);
    loadReviewFixture();
    expect(() => confirmReviewedOrder(original.id, changed.revision, now)).toThrow("Order changed");
  });
  it("makes repeated confirmation idempotent", () => {
    const original = loadReviewFixture();
    const first = confirmReviewedOrder(original.id, original.review!.revision, now);
    const again = confirmReviewedOrder(original.id, first.revision, now);
    expect(again).toEqual(first);
    expect(getState().audit).toHaveLength(1);
  });
  it("rejects unknown, excluded, clean, or unrelated line-item edits without mutation", () => {
    const original = loadReviewFixture();
    const before = structuredClone(getState());
    expect(() => editReviewedOrder(original.id, original.review!.revision, { field: "lineItemQty", lineItemId: "wrong", value: 2 }, now)).toThrow("Line item not found");
    expect(getState()).toEqual(before);
    expect(() => confirmReviewedOrder("unknown", randomUUID(), now)).toThrow("Order not found");
    excludeMerchant(original.merchant.name);
    expect(() => confirmReviewedOrder(original.id, original.review!.revision, now)).toThrow("Order not found");
    const clean = loadReviewFixture([makeOrder({ id: "clean", merchant: { ...original.merchant, name: "Different Store", domain: "different.example" } })]);
    expect(() => confirmReviewedOrder(clean.id, clean.review!.revision, now)).toThrow("not awaiting review");
  });
  it("rejects quantity below returned quantity and avoids partial updates", () => {
    const original = loadReviewFixture([makeOrder({ needsReview: true, confMin: 0.4,
      lineItems: [{ id: "item", name: "Boots", qty: 3, unitPrice: 10, returnedQty: 2 }] })]);
    const before = structuredClone(getState());
    expect(() => editReviewedOrder(original.id, original.review!.revision, { field: "lineItemQty", lineItemId: "item", value: 1 }, now)).toThrow("Corrected order is invalid");
    expect(getState()).toEqual(before);
  });
  it("does not log entered values, and keeps other orders and drafts intact", () => {
    const first = makeOrder({ needsReview: true, confMin: 0.5 });
    const other = makeOrder({ id: "other", events: [makeEvent("return_received", "2026-09-10T10:00:00.000Z", { evidence: "Synthetic return" })] });
    const original = loadReviewFixture([first, other]);
    const otherFinding = getState().findings.find(f => f.orderId === "other")!;
    upsertDraft({ id: "other-draft", findingId: otherFinding.id, subject: "s", body: "b", recipient: "r", signedName: "n" });
    editReviewedOrder(original.id, original.review!.revision, { field: "orderRef", value: "PRIVATE-CORRECTION" }, now);
    expect(getState().drafts[0].id).toBe("other-draft");
    expect(getState().findings).toContainEqual(otherFinding);
    expect(JSON.stringify(getState().audit)).not.toContain("PRIVATE-CORRECTION");
  });
  it("uses demo as-of and preserves simulated price-drop recomputation", () => {
    const observation = seedPriceFeed.observations[0];
    const original = loadReviewFixture([makeOrder({ needsReview: true, confMin: 0.5,
      merchant: { name: observation.merchant, domain: "synthetic.example", policy: {
        returnWindowDays: null, windowAnchor: null, refundSlaDays: null, priceAdjustDays: 30, policySource: null, policyQuote: null, nonReturnable: false,
      } }, placedAt: observation.observedAt, currency: observation.currency,
      lineItems: [{ id: "price-item", name: "Synthetic gear", sku: observation.sku, qty: 1, unitPrice: observation.price + 50, returnedQty: 0 }],
    })]);
    const current = getState();
    setPipelineResult("demo", observation.observedAt, { orders: current.orders, findings: current.findings,
      reviewQueue: current.reviewQueue, stats: current.stats! });
    const order = getOrder(original.id)!;
    const confirmed = confirmReviewedOrder(order.id, order.review!.revision, new Date("2030-01-01T00:00:00Z"));
    expect(confirmed.findings.some(f => f.kind === "price_drop" && f.simulated)).toBe(true);
  });
  it("isolates corrections across accounts with the same order id", () => {
    const first = withStoreScope("first", () => { resetStore(); return loadReviewFixture(); });
    withStoreScope("second", () => { resetStore(); loadReviewFixture(); });
    withStoreScope("first", () => editReviewedOrder(first.id, first.review!.revision, { field: "total", value: 10 }, now));
    expect(withStoreScope("first", () => getOrder(first.id)?.total)).toBe(10);
    expect(withStoreScope("second", () => getOrder(first.id)?.total)).toBe(113);
  });
  it.each([
    { field: "total", value: -1 }, { field: "total", value: 1.123 }, { field: "total", value: null },
    { field: "merchantName", value: " " }, { field: "placedAt", value: "not-a-date" },
    { field: "lineItemQty", lineItemId: "item", value: 1.5 }, { field: "currency", value: "usd" },
    { field: "needsReview", value: false }, { field: "confMin", value: 1 },
  ])("rejects invalid corrections: %j", edit => {
    expect(EditRequestSchema.safeParse({ revision: randomUUID(), edit }).success).toBe(false);
  });
});
