import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getQualityData, getState, resetStore } from "@/lib/store";
import { createLabelStore, scorableLabels, setLabelStore, type LabelStore } from "./labels";
import { markEmailNotAboutOrder, markOrderNotPurchase, restoreOrder } from "./purchase-feedback";
import { getSkippedEmails } from "./state";
import { NOW, fakeLlm, order, publishUpload } from "./test-helpers";

let labels: LabelStore;
beforeEach(() => { resetStore(); labels = createLabelStore(":memory:"); setLabelStore(labels); });
afterEach(() => { setLabelStore(undefined); resetStore(); });

const scope = "anonymous";
const shipped = () => order("o1b", "NW-1", { subject: "Your order #NW-1 has shipped", date: "2026-10-03T10:00:00.000Z",
  text: "Order #NW-1 has shipped. Tracking 1Z999. Order total: $120.00" });
const twoEmails = () => [order("o1", "NW-1"), shipped()];

describe("not about this purchase (one email)", () => {
  it("removes only that email's share, labels only that email, lists it as skipped, audits, and survives a re-sync", async () => {
    await publishUpload(twoEmails(), fakeLlm());
    const before = getState().orders[0];
    expect(before.messageIds.sort()).toEqual(["o1", "o1b"]);
    // Every confirmed order has a "placed" event from its confirmation (#127); the shipped event belongs to o1b.
    expect(before.events.map((event) => [event.type, event.messageId]).sort()).toEqual([["placed", "o1"], ["shipped", "o1b"]]);

    const result = markEmailNotAboutOrder(before.id, "o1b", { now: NOW });
    expect(result).toMatchObject({ orderId: before.id, emailId: "o1b", removedOrder: false });
    const after = getState().orders[0];
    expect(after.messageIds).toEqual(["o1"]);
    expect(after.events.map((event) => event.type)).toEqual(["placed"]);
    expect(after.total).toBe(before.total);
    expect(labels.list(scope).map((label) => [label.emailId, label.class, label.source])).toEqual([["o1b", "not_receipt", "feedback"]]);
    expect(getSkippedEmails().map((entry) => [entry.emailId, entry.reason])).toEqual([["o1b", "marked_not_purchase"]]);
    expect(getState().stats).toMatchObject({ extracted: 1, skipped: 1, orders: 1 });
    expect(getState().audit.filter((entry) => entry.detail.includes("not about this purchase"))).toHaveLength(1);

    // The next sync builds the order from o1 alone: the label is a class override on o1b.
    const { result: resynced } = await publishUpload(twoEmails(), fakeLlm());
    expect(resynced.orders).toHaveLength(1);
    expect(resynced.orders[0].messageIds).toEqual(["o1"]);
    expect(resynced.orders[0].events.map((event) => event.type)).toEqual(["placed"]);
  });

  it("undo restores the email's events, removes the label and puts the counters back", async () => {
    await publishUpload(twoEmails(), fakeLlm());
    const before = getState();
    markEmailNotAboutOrder(before.orders[0].id, "o1b", { now: NOW });
    const result = restoreOrder(before.orders[0].id, { now: NOW });
    expect(result).toMatchObject({ emailIds: ["o1b"] });
    const after = getState();
    expect(after.orders[0].messageIds.sort()).toEqual(["o1", "o1b"]);
    expect(after.orders[0].events.map((event) => event.messageId).sort()).toEqual(["o1", "o1b"]);
    expect(after.stats).toEqual(before.stats);
    expect(labels.list(scope)).toEqual([]);
    expect(getSkippedEmails()).toEqual([]);
    expect(getQualityData().texts.get("o1b")).toMatchObject({ outcome: "extracted" });
    expect(() => restoreOrder(before.orders[0].id)).toThrowError(/Nothing to undo/);
  });

  it("refuses the email that supplied the amounts and unknown emails; a lone email removes the whole order", async () => {
    await publishUpload(twoEmails(), fakeLlm());
    const id = getState().orders[0].id;
    expect(() => markEmailNotAboutOrder(id, "o1")).toThrowError(/supplied this purchase's amounts/);
    expect(() => markEmailNotAboutOrder(id, "zzz")).toThrowError(/not part of this purchase/);
    expect(() => markEmailNotAboutOrder("nope", "o1")).toThrowError(/Order not found/);
    expect(labels.list(scope)).toEqual([]);

    await publishUpload([order("solo", "NW-9")], fakeLlm());
    const solo = getState().orders[0];
    expect(markEmailNotAboutOrder(solo.id, "solo", { now: NOW })).toMatchObject({ removedOrder: true });
    expect(getState().orders).toEqual([]);
  });
});

describe("not a purchase (whole order)", () => {
  it("labels every email, removes the order, undoes back to identical ledger numbers, and a partial mark first still undoes to the original", async () => {
    await publishUpload(twoEmails(), fakeLlm());
    const before = getState();
    const id = before.orders[0].id;
    markEmailNotAboutOrder(id, "o1b", { now: NOW });
    const result = markOrderNotPurchase(id, { now: NOW });
    expect(result).toMatchObject({ orderId: id, emailIds: ["o1"] });
    expect(getState().orders).toEqual([]);
    expect(labels.list(scope).map((label) => label.emailId).sort()).toEqual(["o1", "o1b"]);
    expect(getState().stats).toMatchObject({ extracted: 0, skipped: 2, orders: 0, findings: 0 });
    expect(getSkippedEmails().map((entry) => entry.emailId).sort()).toEqual(["o1", "o1b"]);

    restoreOrder(id, { now: NOW });
    const after = getState();
    expect(after.orders[0].messageIds.sort()).toEqual(["o1", "o1b"]);
    expect(after.orders[0].events).toHaveLength(2);
    expect(after.findings).toEqual(before.findings);
    expect(after.stats).toEqual(before.stats);
    expect(labels.list(scope)).toEqual([]);
  });

  it("puts back the label it replaced, and works without saved email text (class override only, never scored)", async () => {
    await publishUpload([order("o1", "NW-1")], fakeLlm());
    const id = getState().orders[0].id;
    const reviewed = { emailId: "o1", source: "review" as const, class: "order" as const, fields: { merchant: "Northwind Outfitters" },
      redactedText: "Order #NW-1 total $120.00", textHash: "h", subject: "Order confirmation #NW-1", from: '"Northwind" <sender@northwind.example>',
      date: "2026-10-01T10:00:00.000Z", at: "2026-10-02T00:00:00.000Z" };
    labels.upsert(scope, reviewed);
    markOrderNotPurchase(id, { now: NOW });
    expect(labels.get(scope, "o1")).toMatchObject({ class: "not_receipt", source: "feedback", fields: null });
    restoreOrder(id, { now: NOW });
    expect(labels.get(scope, "o1")).toEqual(reviewed);

    getQualityData().texts.clear();
    markOrderNotPurchase(id, { now: NOW });
    const label = labels.get(scope, "o1")!;
    expect(label).toMatchObject({ class: "not_receipt", source: "feedback", redactedText: "", subject: "Northwind Outfitters order NW-1" });
    expect(scorableLabels(scope)).toEqual([]);
    expect(getSkippedEmails().map((entry) => [entry.emailId, entry.reason])).toEqual([["o1", "marked_not_purchase"]]);
  });

  it("labels exact copies folded into the order too (dedup keeps their ids on it), so a re-sync skips them all", async () => {
    const copies = () => [order("o1", "NW-1"), order("o1-copy", "NW-1")];
    await publishUpload(copies(), fakeLlm());
    const before = getState();
    expect(before.orders).toHaveLength(1);
    expect(before.orders[0].messageIds.sort()).toEqual(["o1", "o1-copy"]);
    markOrderNotPurchase(before.orders[0].id, { now: NOW });
    expect(labels.list(scope).map((label) => label.emailId).sort()).toEqual(["o1", "o1-copy"]);
    restoreOrder(before.orders[0].id, { now: NOW });
    expect(getState().stats).toEqual(before.stats);
    expect(getState().orders[0].messageIds.sort()).toEqual(["o1", "o1-copy"]);
    markOrderNotPurchase(before.orders[0].id, { now: NOW });
    const { result } = await publishUpload(copies(), fakeLlm());
    expect(result.orders).toEqual([]);
    expect(result.stats).toMatchObject({ skipped: 2, orders: 0 });
  });

  it("needs a ledger and a known order", async () => {
    expect(() => markOrderNotPurchase("x")).toThrowError(/no ledger/);
    await publishUpload([order("o1", "NW-1")], fakeLlm());
    expect(() => markOrderNotPurchase("x")).toThrowError(/Order not found/);
    expect(() => restoreOrder("x")).toThrowError(/Nothing to undo/);
  });

  it("an upload replaces the ledger, so an older undo is no longer offered", async () => {
    await publishUpload([order("o1", "NW-1")], fakeLlm());
    const id = getState().orders[0].id;
    markOrderNotPurchase(id, { now: NOW });
    await publishUpload([order("o2", "NW-2")], fakeLlm());
    expect(() => restoreOrder(id)).toThrowError(/Nothing to undo/);
  });
});
