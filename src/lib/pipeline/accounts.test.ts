import { describe, expect, it } from "vitest";
import { mergeAccountResults, type AccountPipelineResult } from "./accounts";
import { JACKET, NOW, email, resultOf } from "./accounts.fixtures";
const SAME_ORDER_CONFIRMATION = (id: string, source: string) =>
  email(id, "order", "2026-08-20T10:00:00Z", { lineItems: [JACKET], totals: { total: 80 }, refundSlaDays: 7 }, source);
const SAME_ORDER_RETURN = (id: string, source: string) =>
  email(id, "return_received", "2026-09-01T10:00:00Z", { lineItems: [JACKET] }, source);

function accountResults(): AccountPipelineResult[] {
  // Both inboxes got the confirmation and the return notice (e.g. a shared household order); only B has a second order.
  const a = resultOf([SAME_ORDER_CONFIRMATION("a-1", "acct-a"), SAME_ORDER_RETURN("a-2", "acct-a")]);
  const b = resultOf([SAME_ORDER_CONFIRMATION("b-1", "acct-b"), SAME_ORDER_RETURN("b-2", "acct-b"),
    email("b-3", "order", "2026-09-05T10:00:00Z", { orderRef: "NW-2002", lineItems: [{ ...JACKET, sku: "NW-RJ-9" }], totals: { total: 80 } }, "acct-b")]);
  return [{ accountId: "acct-a", asOf: NOW.toISOString(), result: a }, { accountId: "acct-b", asOf: NOW.toISOString(), result: b }];
}

describe("mergeAccountResults", () => {
  it("keeps the matcher's sources per order (RawEmail.sourceAccount)", () => {
    const [{ result }] = accountResults();
    expect(result.orders.map(order => order.sources)).toEqual([["acct-a"]]);
  });

  it("merges the same order seen in two inboxes into one order with both sources and one finding", () => {
    const [a, b] = accountResults();
    expect(a.result.findings).toHaveLength(1);
    expect(b.result.findings).toHaveLength(1); // each inbox alone would report the overdue refund
    const merged = mergeAccountResults([a, b], NOW).result;
    expect(merged.orders.map(order => order.id)).toEqual([
      "order:northwind-outfitters:nw-1001", "order:northwind-outfitters:nw-2002",
    ]);
    const shared = merged.orders[0];
    expect(shared.sources).toEqual(["acct-a", "acct-b"]);
    expect(shared.messageIds.sort()).toEqual(["a-1", "a-2", "b-1", "b-2"]);
    expect(shared.events.map(event => event.type)).toEqual(["return_received"]); // duplicate notice is one event
    expect(shared.total).toBe(80);
    expect(merged.orders[1].sources).toEqual(["acct-b"]);
    expect(merged.findings.map(finding => finding.id)).toEqual(a.result.findings.map(finding => finding.id));
    expect(merged.stats).toMatchObject({ emails: 5, extracted: 5, orders: 2, findings: 1, classes: { order: 5 },
      extractionOrigins: { llm: 5 } });
  });

  it("does not depend on the order the accounts are given in", () => {
    const [a, b] = accountResults();
    expect(mergeAccountResults([b, a], NOW)).toEqual(mergeAccountResults([a, b], NOW));
  });

  it("keeps an account's orders and findings untouched when the other inbox has nothing in common", () => {
    const [a] = accountResults();
    const other = resultOf([email("c-1", "order", "2026-09-01T10:00:00Z", { merchant: "Fabrikam", merchantDomain: "fabrikam.example",
      orderRef: "FB-7", totals: { total: 20 }, lineItems: [{ name: "Mug", qty: 1, unitPrice: 20 }] }, "acct-c")]);
    const merged = mergeAccountResults([a, { accountId: "acct-c", asOf: NOW.toISOString(), result: other }], NOW).result;
    expect(merged.orders.map(order => order.sources)).toEqual([["acct-a"], ["acct-c"]]);
    expect(merged.findings).toEqual(a.result.findings);
  });

  it("passes a single account through unchanged, only tagging orders without sources", () => {
    const demo = resultOf([email("d-1", "order", "2026-09-01T10:00:00Z", { totals: { total: 80 }, lineItems: [JACKET] })]);
    const { result } = mergeAccountResults([{ accountId: "acct-d", asOf: NOW.toISOString(), result: demo }], NOW);
    expect(result.orders.map(order => order.sources)).toEqual([["acct-d"]]);
    expect(result.findings).toBe(demo.findings);
    expect(result.reviewQueue).toBe(demo.reviewQueue);
    expect(result.stats).toBe(demo.stats);
  });

  it("merges a bare lifecycle copy into the confirmed order and keeps the review items of other orders", () => {
    const confirmed = resultOf([SAME_ORDER_CONFIRMATION("a-1", "acct-a")]);
    const orphan = resultOf([SAME_ORDER_RETURN("b-2", "acct-b")]);
    expect(orphan.orders[0].needsReview).toBe(true);
    const review = { emailId: "b-9", stage: "extract" as const, reason: "low extraction confidence 0.50" };
    const merged = mergeAccountResults([
      { accountId: "acct-a", asOf: NOW.toISOString(), result: confirmed },
      { accountId: "acct-b", asOf: NOW.toISOString(), result: { ...orphan, reviewQueue: [review, { emailId: "b-2", stage: "match", orderId: orphan.orders[0].id, reason: "order needs review: x" }] } },
    ], NOW).result;
    expect(merged.orders).toHaveLength(1);
    expect(merged.orders[0]).toMatchObject({ total: 80, needsReview: false, sources: ["acct-a", "acct-b"] });
    expect(merged.orders[0].events.map(event => event.type)).toEqual(["return_received"]);
    expect(merged.findings.map(finding => finding.kind)).toEqual(["refund_overdue"]);
    expect(merged.reviewQueue).toEqual([review]);
  });
});
