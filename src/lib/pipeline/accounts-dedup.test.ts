import { describe, expect, it } from "vitest";
import { DEDUP_SPECS, extractionOf, rawEmailOf, type DedupSpec } from "@/lib/orders/dedup/dedup-fixtures";
import type { MatchInput } from "@/lib/orders/matcher";
import { mergeAccountResults } from "./accounts";
import { NOW, resultOf } from "./accounts.fixtures";

// Cross-inbox dedup at the account merge (#126): same purchase under another id, same email in two inboxes.
const spec = (id: string, overrides: Partial<DedupSpec> = {}): MatchInput => {
  const base = { ...DEDUP_SPECS.find((candidate) => candidate.id === id)!, ...overrides };
  return { email: rawEmailOf(base), extraction: extractionOf(base) };
};
const account = (accountId: string, ...inputs: MatchInput[]) => ({ accountId, asOf: NOW.toISOString(), result: resultOf(inputs) });

describe("mergeAccountResults dedup", () => {
  it("joins the same order spelled differently in two inboxes (merchant alias + canonical order number)", () => {
    const a = account("acct-a", spec("ebay-a"));
    const b = account("acct-b", spec("ebay-b"));
    expect(a.result.orders[0].id).not.toBe(b.result.orders[0].id);
    const merged = mergeAccountResults([a, b], NOW).result;
    expect(merged.orders).toHaveLength(1);
    const [order] = merged.orders;
    expect(order.sources).toEqual(["acct-a", "acct-b"]);
    expect(order.messageIds.sort()).toEqual(["ebay-a", "ebay-b"]);
    expect(order.aliasIds).toEqual([b.result.orders[0].id]);
    expect(order.lineItems).toHaveLength(1);
    expect(order.lineItems[0].id.startsWith(`${order.id}:`)).toBe(true);
    expect(merged.stats.dedup).toMatchObject({ merges: { shared_ref: 1 }, possibleDuplicates: 0 });
    expect(merged.findings.every((finding) => finding.orderId === order.id)).toBe(true);
  });

  it("joins the same email (one Message-ID) delivered to two inboxes even without an order number", () => {
    const merged = mergeAccountResults([account("acct-a", spec("bb-acct-a")), account("acct-b", spec("bb-acct-b"))], NOW).result;
    expect(merged.orders).toHaveLength(1);
    expect(merged.orders[0].sources).toEqual(["acct-a", "acct-b"]);
    expect(merged.stats.dedup?.merges).toEqual({ message_id: 1 });
  });

  it("does not merge look-alikes across inboxes: flags them as a possible duplicate instead", () => {
    const merged = mergeAccountResults([account("acct-a", spec("coffee-am")), account("acct-b", spec("coffee-pm"))], NOW).result;
    expect(merged.orders).toHaveLength(2);
    expect(merged.orders.filter((order) => order.possibleDuplicateOf)).toHaveLength(1);
    expect(merged.stats.dedup?.possibleDuplicates).toBe(1);
  });

  it("does not merge orders with different numbers or recurring charges across inboxes", () => {
    const different = mergeAccountResults([account("acct-a", spec("nw-order-5001")), account("acct-b", spec("nw-order-5002"))], NOW).result;
    expect(different.orders).toHaveLength(2);
    const recurring = mergeAccountResults([account("acct-a", spec("sub-sep")), account("acct-b", spec("sub-oct"))], NOW).result;
    expect(recurring.orders).toHaveLength(2);
  });

  it("the merge result does not depend on the order of the accounts", () => {
    const a = account("acct-a", spec("ebay-a"), spec("coffee-am"));
    const b = account("acct-b", spec("ebay-b"), spec("coffee-pm"));
    expect(mergeAccountResults([b, a], NOW)).toEqual(mergeAccountResults([a, b], NOW));
  });
});
