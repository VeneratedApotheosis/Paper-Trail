import { describe, expect, it } from "vitest";
import { DEDUP_SPECS, extractionOf, rawEmailOf, type DedupSpec } from "./dedup/dedup-fixtures";
import { matchOrders, matchOrdersWithReasons, type MatchInput } from "./matcher";

const spec = (id: string) => DEDUP_SPECS.find((candidate) => candidate.id === id)!;
const inputOf = (item: DedupSpec): MatchInput => ({ email: rawEmailOf(item), extraction: extractionOf(item) });
const inputs = (...ids: string[]) => ids.map((id) => inputOf(spec(id)));

describe("matchOrders dedup (#126): merging", () => {
  it("one purchase from Amazon name variants keeps the earliest email's id and lists the others as aliases", () => {
    const [order, ...rest] = matchOrders(inputs("amz-order", "amz-ship", "amz-delivered"));
    expect(rest).toEqual([]);
    expect(order.id).toBe("order:amazon-com:112-1234567-1234567");
    expect(order.aliasIds).toEqual(["order:amazon-marketplace:112-1234567-1234567", "order:amazon:1121234567-1234567"]);
    expect(order.messageIds.sort()).toEqual(["amz-delivered", "amz-order", "amz-ship"]);
    expect(order.events.map((event) => event.type)).toEqual(["placed", "shipped", "delivered"]);
  });

  it("joins an invoice and a confirmation through ANY shared reference (otherRefs)", () => {
    const orders = matchOrders(inputs("baz-confirm", "baz-invoice", "baz-shipped"));
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe("order:bazaarly:ord-1001");
    expect(orders[0].aliasIds).toContain("order:bazaarly-inc:web-77-ab");
  });

  it("attaches a ref-less late delivery and a ref-less refund by items and amount, with no reorder of ids", () => {
    const delivered = matchOrders(inputs("fc-order", "fc-shipped", "fc-delivered"));
    expect(delivered).toHaveLength(1);
    expect(delivered[0].id).toBe("order:freshcart-home:fc-9001");
    const refunded = matchOrders(inputs("nw-order-4001", "nw-refund-4001"));
    expect(refunded).toHaveLength(1);
    expect(refunded[0].events.map((event) => event.type)).toEqual(["placed", "refund_issued"]);
  });

  it("keeps every copy's id, account and keys as provenance when the pipeline collapsed copies into an email", () => {
    const [first, second] = inputs("bb-acct-a", "bb-acct-b");
    const [order] = matchOrders([{ ...first, copies: [{ id: second.email.id, sourceAccount: "acct-b", reason: "message_id", keys: ["mid:bb-receipt-9@brewbox.example"] }] }]);
    expect(order.messageIds).toEqual(["bb-acct-a", "bb-acct-b"]);
    expect(order.sources).toEqual(["acct-a", "acct-b"]);
    expect(order.emailKeys).toContain("mid:bb-receipt-9@brewbox.example");
  });

  it("reports what merged and why", () => {
    const { dedup } = matchOrdersWithReasons(inputs("amz-order", "amz-ship", "baz-confirm", "baz-invoice", "fc-order", "fc-delivered"));
    expect(dedup.merges).toEqual({ shared_ref: 2, items_amount: 1 });
    expect(dedup.possibleDuplicates).toBe(0);
  });

  it("legacyGrouping reproduces the old name-slug behaviour for the before/after report", () => {
    expect(matchOrders(inputs("amz-order", "amz-ship", "amz-delivered"), { legacyGrouping: true })).toHaveLength(3);
    expect(matchOrders(inputs("sub-sep", "sub-oct", "sub-nov"), { legacyGrouping: true })).toHaveLength(1);
  });
});

describe("matchOrders dedup (#126): never merging", () => {
  it("keeps a monthly subscription's charges apart with unique, stable ids (the later ones get :2, :3)", () => {
    const orders = matchOrders(inputs("sub-sep", "sub-oct", "sub-nov"));
    expect(orders.map((order) => order.id)).toEqual([
      "order:voltline-cloud:sub-4455", "order:voltline-cloud:sub-4455:2", "order:voltline-cloud:sub-4455:3",
    ]);
    expect(orders.every((order) => order.possibleDuplicateOf === undefined)).toBe(true);
  });

  it("flags two identical ref-less coffees as a possible duplicate with a reason, and still counts both", () => {
    const orders = matchOrders(inputs("coffee-am", "coffee-pm"));
    expect(orders).toHaveLength(2);
    const flagged = orders.find((order) => order.possibleDuplicateOf);
    expect(flagged?.messageIds).toEqual(["coffee-pm"]);
    expect(flagged?.possibleDuplicateOf).toMatchObject({ orderId: orders.find((order) => !order.possibleDuplicateOf)!.id });
    expect(flagged?.possibleDuplicateOf?.reason).toMatch(/same total.*no shared order number/);
    expect(flagged?.possibleDuplicateOf?.score).toBeGreaterThanOrEqual(35);
  });

  it("does not merge two orders with different numbers, nor the same number at two merchants", () => {
    expect(matchOrders(inputs("nw-order-5001", "nw-order-5002"))).toHaveLength(2);
    expect(matchOrders(inputs("ref-clash-a", "ref-clash-b"))).toHaveLength(2);
  });

  it("a refund above the order total is its own (review) order, not that order's refund", () => {
    const { orders } = matchOrdersWithReasons(inputs("vl-order", "vl-big-refund"));
    expect(orders).toHaveLength(2);
    expect(orders.find((order) => order.messageIds.includes("vl-order"))?.events.map((event) => event.type)).toEqual(["placed"]);
  });

  it("a refund above the total that names the order attaches but goes to review with a reason", () => {
    const refund: DedupSpec = { ...spec("vl-big-refund"), id: "vl-named-refund", ref: "VL-8801" };
    const { orders, reviewReasons } = matchOrdersWithReasons([inputOf(spec("vl-order")), inputOf(refund)]);
    expect(orders).toHaveLength(1);
    expect(orders[0].needsReview).toBe(true);
    expect(reviewReasons.get(orders[0].id)?.join(" ")).toMatch(/refund is more than the order total \(email vl-named-refund\)/);
  });

  it("a platform-sent POS receipt keeps two shops and two visits apart (NT$ / TWD)", () => {
    const orders = matchOrders(inputs("kor-a", "kor-a-resent", "kor-b", "tea-a"));
    expect(orders.map((order) => [order.merchant.name, order.currency, order.messageIds.length])).toEqual([
      ["Tea House Taipei", "TWD", 1], ["korea moos", "TWD", 2], ["korea moos", "TWD", 1],
    ]);
  });

  it("Shopify sequence (confirmed, on the way, out for delivery, delivered) is ONE order even when the shipment emails carry a shipment id, a tracking number or nothing as order ref", () => {
    const [order, ...rest] = matchOrders(inputs("blk-confirmed", "blk-on-the-way", "blk-out-for-delivery", "blk-delivered"));
    expect(rest).toEqual([]);
    expect(order).toMatchObject({ id: "order:bowlish-keys:blk-9129", total: 66, orderRef: "BLK-9129" });
    expect(order.messageIds).toHaveLength(4);
    expect(order.merchant.domain).toBe("bowlish-keys.example");
    expect(order.events.map((event) => event.type)).toEqual(["placed", "shipped", "out_for_delivery", "delivered"]);
    // Order of arrival must not matter (delivered first, confirmation last).
    expect(matchOrders(inputs("blk-delivered", "blk-out-for-delivery", "blk-on-the-way", "blk-confirmed"))).toEqual([order]);
  });

  it("a bare lifecycle email (no number, items or amount) joins the merchant's only order in its window, not a second one", () => {
    const orders = matchOrders(inputs("bare-order", "bare-delivered"));
    expect(orders).toHaveLength(1);
    expect(orders[0].events.map((event) => event.type)).toEqual(["placed", "delivered"]);
    const two = matchOrders([...inputs("bare-order", "bare-delivered"), inputOf({ ...spec("bare-order"), id: "bare-order-2", ref: "TH-9999", date: "2026-09-11T10:00:00Z" })]);
    // With two open orders it is ambiguous, so the delivery email stays alone (for review) rather than guessing.
    expect(two).toHaveLength(3);
    expect(two.find((order) => order.messageIds.includes("bare-delivered"))?.messageIds).toEqual(["bare-delivered"]);
  });

  it("is deterministic whatever order the emails arrive in", () => {
    const all = DEDUP_SPECS.map(inputOf);
    const forward = matchOrders(all);
    expect(matchOrders([...all].reverse())).toEqual(forward);
  });
});
