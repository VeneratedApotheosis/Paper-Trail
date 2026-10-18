import { describe, expect, it } from "vitest";
import type { RawEmail } from "@/lib/contracts";
import { clusterCandidates } from "./cluster";
import { ExactCopyRegistry, bodyFingerprint, emailKeys, normalizeMessageId } from "./exact";
import { merchantKeys, registrableDomain, sameMerchant } from "./merchant";
import { canonicalRef, canonicalRefs, isStrongRef } from "./refs";
import {
  AUTO_MERGE_SCORE, LIFECYCLE_WINDOW_DAYS, POSSIBLE_DUPLICATE_SCORE, scorePair, type DedupCandidate,
} from "./score";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-09-01T10:00:00Z");

function candidate(overrides: Partial<DedupCandidate> = {}): DedupCandidate {
  return {
    merchantKeys: ["name:northwind"], refs: [], primaryRef: null, kind: "confirmation", emailClass: "order", currency: "USD",
    amount: 100, at: T0, items: [{ key: "rain-jacket", sku: null, unitPrice: 100, qty: 1 }], exactKeys: [], threadKey: null,
    ...overrides,
  };
}
const withRef = (ref: string, overrides: Partial<DedupCandidate> = {}) => candidate({ refs: [canonicalRef(ref)!], primaryRef: canonicalRef(ref), ...overrides });

describe("canonicalRef", () => {
  it("ignores case, #, spacing, dashes, label words and leading zeros", () => {
    const same = ["NW-2041", "nw2041", "#NW 2041", "Order #NW-2041", "NW-02041"];
    expect(new Set(same.map((ref) => canonicalRef(ref))).size).toBe(1);
    expect(canonicalRef("112-1234567-1234567")).toBe(canonicalRef("#112 1234567 1234567"));
    expect(canonicalRef("ORD-0042")).toBe(canonicalRef("42"));
  });

  it("keeps different references apart and returns null for nothing", () => {
    expect(canonicalRef("NW-2041")).not.toBe(canonicalRef("NW-2042"));
    expect(canonicalRef("")).toBeNull();
    expect(canonicalRef(null)).toBeNull();
    expect(canonicalRef("###")).toBeNull();
  });

  it("only labels that are whole words are dropped (NORTH123 stays)", () => {
    expect(canonicalRef("NORTH123")).toBe("NORTH123");
    expect(canonicalRef("NO-5521")).toBe("5521");
  });

  it("strong refs need 4+ characters with a digit; canonicalRefs lists primary first without duplicates", () => {
    expect(isStrongRef(canonicalRef("A-1"))).toBe(false);
    expect(isStrongRef(canonicalRef("PENDING"))).toBe(false);
    expect(isStrongRef(canonicalRef("NW-2041"))).toBe(true);
    expect(canonicalRefs("NW-1", ["INV 77", "nw1", "WEB-77"])).toEqual(["NW1", "77"]);
  });
});

describe("merchantKeys", () => {
  const keys = (from: string, merchant: string | null, extra: { subject?: string; domain?: string | null } = {}) =>
    merchantKeys({ from, subject: extra.subject ?? "Your order", merchant, merchantDomain: extra.domain ?? null });

  it("maps Amazon variants across domains and names to one alias", () => {
    const variants = [
      keys('"Amazon.com" <auto-confirm@amazon.com>', "Amazon.com"),
      keys('"Amazon" <ship@amazon.co.uk>', "AMAZON MARKETPLACE"),
      keys('"Amazon" <order-update@amazon.de>', "Amazon"),
      keys('"someone" <x@gmail.com>', "Amazon EU"),
    ];
    for (const variant of variants) expect(variant).toContain("alias:amazon");
    expect(sameMerchant(variants[0], variants[1])).toBe(true);
  });

  it("uses the registrable domain of the sender and the name slug, ignoring corporate suffixes", () => {
    const a = keys('"Northwind Outfitters" <orders@northwind.example>', "Northwind Outfitters");
    const b = keys('"Northwind" <billing@mail.northwind.example>', "Northwind Outfitters, Inc.");
    expect(a).toEqual(expect.arrayContaining(["dom:northwind.example", "name:northwind-outfitters"]));
    expect(sameMerchant(a, b)).toBe(true);
    expect(registrableDomain("mail.shop.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("www.northwind.example")).toBe("northwind.example");
  });

  it("does not trust a mailbox provider, a platform or a forwarder's own domain as the shop", () => {
    expect(keys('"Sam" <sam@gmail.com>', "Lumen Beauty")).toEqual(["name:lumen-beauty"]);
    expect(keys('"korea moos" <noreply@shoplineapp.com>', "korea moos")).toEqual(["name:korea-moos"]);
    expect(keys('"Sam" <sam@work.example>', "Lumen Beauty", { subject: "Fwd: your order" })).toEqual(["name:lumen-beauty"]);
  });

  it("never matches different shops on a weak key alone", () => {
    expect(sameMerchant(keys('"A" <a@oakhaven.example>', "Oakhaven Books"), keys('"B" <b@oakhaven-books.example>', "Oakhaven Home"))).toBe(false);
  });
});

describe("exact copies", () => {
  const raw = (overrides: Partial<RawEmail> = {}): RawEmail => ({
    id: "g1", from: '"Brewbox" <orders@brewbox.example>', subject: "Your receipt", date: "2026-09-20T07:45:00.000Z",
    text: "Flat White  $4.50\nTotal $4.50", ...overrides,
  });

  it("normalizes Message-ID and builds stable keys", () => {
    expect(normalizeMessageId(" <AbC@Mail.Example> ")).toBe("abc@mail.example");
    expect(normalizeMessageId("")).toBeNull();
    expect(emailKeys(raw({ messageId: "<AbC@mail.example>" }))).toEqual(["mid:abc@mail.example", `fp:${bodyFingerprint(raw())}`]);
    expect(bodyFingerprint(raw({ subject: "Fwd: Your receipt", text: "flat   white $4.50\nTOTAL $4.50" }))).toBe(bodyFingerprint(raw()));
    expect(bodyFingerprint(raw({ text: "  " }))).toBeNull();
  });

  it("collapses the same Message-ID (different Gmail ids, any account), only for the same class", () => {
    const registry = new ExactCopyRegistry();
    registry.add(0, raw({ messageId: "<m1@brewbox.example>", sourceAccount: "a" }), "order");
    expect(registry.find(raw({ id: "g2", messageId: "m1@BREWBOX.example", sourceAccount: "b" }), "order")).toEqual({ index: 0, reason: "message_id" });
    expect(registry.find(raw({ id: "g3", messageId: "m1@brewbox.example" }), "shipped")).toBeNull();
    expect(registry.find(raw({ id: "g4", messageId: "m2@brewbox.example", text: "different" }), "order")).toBeNull();
  });

  it("collapses identical bodies across inboxes within a day, but never inside one inbox (two identical coffees)", () => {
    const registry = new ExactCopyRegistry();
    registry.add(0, raw({ sourceAccount: "a" }), "order");
    expect(registry.find(raw({ id: "g2", sourceAccount: "b" }), "order")).toEqual({ index: 0, reason: "fingerprint" });
    // Two different Message-IDs are two different messages, whatever the bodies say.
    expect(registry.find(raw({ id: "g2b", sourceAccount: "b", messageId: "y@brewbox.example" }), "order")).toEqual({ index: 0, reason: "fingerprint" });
    expect(registry.find(raw({ id: "g3", sourceAccount: "a", messageId: "z@brewbox.example", date: "2026-09-20T15:00:00.000Z" }), "order")).toBeNull();
    expect(registry.find(raw({ id: "g4", sourceAccount: "b", messageId: "w@brewbox.example", date: "2026-09-22T07:45:00.000Z" }), "order")).toBeNull();
  });
});

describe("scorePair hard constraints", () => {
  it("never merges confirmations of one merchant with different order numbers, however alike they are", () => {
    const result = scorePair(withRef("NW-5001"), withRef("NW-5002"));
    expect(result.blocked).toMatch(/different order references/);
    expect(result.decision).toBe("none");
  });

  it("never merges the same total again ~monthly, even with the same reference", () => {
    const result = scorePair(withRef("SUB-4455"), withRef("SUB-4455", { at: T0 + 30 * DAY }));
    expect(result.blocked).toMatch(/recurring/);
  });

  it("merges the same reference when the totals differ (an order update) even weeks later", () => {
    expect(scorePair(withRef("OK-100"), withRef("OK-100", { amount: 120, at: T0 + 25 * DAY })).decision).toBe("merge");
  });

  it("different merchants or currencies never score", () => {
    expect(scorePair(candidate(), candidate({ merchantKeys: ["name:other"] })).blocked).toBe("different merchant");
    expect(scorePair(withRef("NW-5001"), withRef("NW-5001", { currency: "EUR" })).blocked).toBe("different currencies");
  });

  it("two numberless confirmations are flagged possible, never merged", () => {
    const result = scorePair(candidate(), candidate({ at: T0 + 5 * 3600_000 }));
    expect(result.decision).toBe("possible");
    expect(result.score).toBeGreaterThanOrEqual(AUTO_MERGE_SCORE);
    expect(result.mergeReason).toBeNull();
  });

  it("a numberless confirmation joins a numbered one when everything else agrees within 3 days, not later", () => {
    expect(scorePair(withRef("NW-1"), candidate({ at: T0 + DAY })).decision).toBe("merge");
    expect(scorePair(withRef("NW-1"), candidate({ at: T0 + 5 * DAY })).decision).not.toBe("merge");
  });

  it("the same Message-ID merges regardless of everything else", () => {
    const result = scorePair(candidate({ exactKeys: ["mid:a"], amount: 1 }), candidate({ exactKeys: ["mid:a"], amount: 2 }));
    expect(result).toMatchObject({ decision: "merge", mergeReason: "message_id" });
    expect(scorePair(candidate({ exactKeys: ["fp:a"] }), candidate({ exactKeys: ["fp:a"] })).mergeReason).toBe("fingerprint");
  });
});

describe("lifecycle windows and refunds (E)", () => {
  const order = candidate({ refs: ["NW4001"], primaryRef: "NW4001", amount: 80, items: [{ key: "rain-jacket", sku: null, unitPrice: 80, qty: 1 }] });
  const event = (emailClass: DedupCandidate["emailClass"], days: number, overrides: Partial<DedupCandidate> = {}) =>
    candidate({ kind: "lifecycle", emailClass, amount: null, at: T0 + days * DAY, items: [{ key: "rain-jacket", sku: null, unitPrice: 80, qty: 1 }], ...overrides });

  it("attaches delivery inside ~30 days and refunds inside ~90 by items (and amount)", () => {
    expect(scorePair(order, event("delivered", 7)).decision).toBe("merge");
    expect(scorePair(order, event("refund", 21, { amount: 80 })).decision).toBe("merge");
    expect(scorePair(order, event("refund", 80, { amount: 80 })).decision).toBe("merge");
  });

  it("blocks events outside their window or dated before the order", () => {
    expect(LIFECYCLE_WINDOW_DAYS.delivered).toBe(30);
    expect(LIFECYCLE_WINDOW_DAYS.refund).toBe(90);
    expect(scorePair(order, event("delivered", 31)).blocked).toMatch(/window/);
    expect(scorePair(order, event("refund", 91, { amount: 80 })).blocked).toMatch(/window/);
    expect(scorePair(order, event("shipped", -3)).blocked).toMatch(/before the order/);
  });

  it("a refund above the order total is not attached by items and amount", () => {
    expect(scorePair(order, event("refund", 5, { amount: 80.01 })).blocked).toMatch(/more than the order total/);
  });

  it("a refund above the total that names the order still attaches, with a warning for review", () => {
    const named = event("refund", 5, { amount: 90, refs: ["NW4001"] });
    expect(scorePair(order, named)).toMatchObject({ decision: "merge", mergeReason: "shared_ref", warning: "refund is more than the order total" });
  });

  it("an event naming another order never attaches by amount", () => {
    expect(scorePair(order, event("shipped", 2, { refs: ["ZZ9999"], primaryRef: "ZZ9999" })).blocked).toMatch(/different order/);
  });

  it("items alone give a middle-band flag, not a merge", () => {
    const flag = scorePair(order, event("delivered", 20, { items: [{ key: "rain-jacket", sku: null, unitPrice: 80, qty: 1 }, { key: "x", sku: null, unitPrice: 1, qty: 1 }] }));
    expect(flag.score).toBeGreaterThanOrEqual(POSSIBLE_DUPLICATE_SCORE);
  });
});

describe("clusterCandidates", () => {
  it("does not let an email that lists two order numbers chain two orders together", () => {
    const a = withRef("NW-6001", { amount: 10 });
    const b = withRef("NW-6002", { amount: 20, at: T0 + DAY });
    const summary = candidate({ kind: "lifecycle", emailClass: "shipped", refs: ["NW6001", "NW6002"], primaryRef: "NW6001", amount: null, at: T0 + 2 * DAY });
    const { clusters } = clusterCandidates([a, b, summary]);
    expect(clusters).toHaveLength(2);
    expect(clusters.find((cluster) => cluster.includes(2))).toContain(0);
  });

  it("leaves a lifecycle email that fits two orders equally unattached and flags it", () => {
    const a = candidate({ primaryRef: "AA1111", refs: ["AA1111"], amount: 60, items: [{ key: "socks", sku: null, unitPrice: 30, qty: 2 }] });
    const b = candidate({ primaryRef: "BB2222", refs: ["BB2222"], amount: 60, at: T0 + 3600_000, items: [{ key: "socks", sku: null, unitPrice: 30, qty: 2 }] });
    const shipped = candidate({ kind: "lifecycle", emailClass: "shipped", amount: null, at: T0 + 2 * DAY, items: [{ key: "socks", sku: null, unitPrice: 30, qty: 2 }] });
    const { clusters, possibleDuplicates } = clusterCandidates([a, b, shipped]);
    expect(clusters).toHaveLength(3);
    expect(possibleDuplicates.map((flag) => flag.node)).toEqual([2]);
    expect(possibleDuplicates[0].reasons).toContain("matches another order about as well");
  });

  it("is deterministic: the same candidates give the same clusters", () => {
    const list = [withRef("NW-1"), withRef("NW-1", { amount: 5 }), candidate({ at: T0 + DAY })];
    expect(clusterCandidates(list)).toEqual(clusterCandidates(list));
  });
});
