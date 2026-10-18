import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { confirmReviewedOrder, editReviewedOrder } from "@/lib/review/service";
import { appendAudit, deleteAll, getQualityData, getState, resetStore, setPipelineResult, withStoreScope } from "@/lib/store";
import { QualityError, markNotReceipt, markSkippedAsReceipt, recordReviewLabel } from "./feedback";
import { createLabelStore, setLabelStore, type LabelStore } from "./labels";
import { getQualityReports, getSkippedEmails } from "./state";
import { NEWSLETTER, NOW, PROMO, fakeLlm, order, publishUpload, unavailableLlm } from "./test-helpers";

let labels: LabelStore;
beforeEach(() => { resetStore(); labels = createLabelStore(":memory:"); setLabelStore(labels); });
afterEach(() => { setLabelStore(undefined); resetStore(); });

const scope = "anonymous";
const emails = () => [order("o1", "NW-1"), NEWSLETTER, PROMO];

describe("sync quality state", () => {
  it("records the run with a latest report, capped history and skipped emails", async () => {
    const { report } = await publishUpload(emails(), fakeLlm());
    expect(report).toMatchObject({ id: "q1", source: "upload", extracted: 1, prefilteredOut: 1, skippedNonReceipt: 1 });
    expect(getQualityReports().latest).toEqual(report);
    expect(getSkippedEmails().map((entry) => [entry.emailId, entry.reason])).toEqual([["news-1", "prefilter"], ["promo-1", "marketing"]]);
    for (let run = 0; run < 25; run++) await publishUpload([order("o1", "NW-1")], fakeLlm());
    const { history, latest } = getQualityReports();
    expect(history).toHaveLength(20);
    expect(latest?.id).toBe("q26");
    expect(history[0].id).toBe("q7");
    // An upload replaces the whole ledger, so earlier skipped emails are gone.
    expect(getSkippedEmails()).toEqual([]);
  });
});

describe("this is a receipt", () => {
  it("extracts a skipped email through the normal merge and rules, saves a label, audits and unlists it", async () => {
    await publishUpload(emails(), fakeLlm());
    const before = getState().orders.length;
    const llm = fakeLlm("fake-model", { total: 55 });
    const result = await markSkippedAsReceipt("promo-1", { llm, now: NOW });
    expect(result).toMatchObject({ emailId: "promo-1", class: "order", extracted: true, labeled: true, excludedMerchant: false });
    const state = getState();
    expect(state.orders).toHaveLength(before + 1);
    const added = state.orders.find((candidate) => candidate.messageIds.includes("promo-1"));
    expect(added).toMatchObject({ id: result.orderId, total: 55, merchant: { name: "Northwind Outfitters" } });
    expect(getSkippedEmails().map((entry) => entry.emailId)).toEqual(["news-1"]);
    expect(state.stats).toMatchObject({ extracted: 2, skipped: 0, orders: before + 1 });
    expect(llm.requests).toHaveLength(1);
    // The extraction prompt carried redacted text only.
    expect(llm.requests[0].user).not.toContain("deals@northwind.example");

    expect(labels.get(scope, "promo-1")).toMatchObject({ source: "feedback", class: "order", fields: null, subject: PROMO.subject });
    expect(state.audit.some((entry) => entry.type === "approval" && entry.detail.includes("Marked email promo-1 as a receipt"))).toBe(true);
    expect(state.audit.some((entry) => entry.type === "llm_call" && entry.detail.includes("promo-1"))).toBe(true);
  });

  it("accepts an explicit receipt class and refuses non-receipt classes or unknown emails", async () => {
    await publishUpload(emails(), fakeLlm());
    expect((await markSkippedAsReceipt("news-1", { llm: fakeLlm(), class: "refund", now: NOW })).class).toBe("refund");
    expect(labels.get(scope, "news-1")?.class).toBe("refund");
    await expect(markSkippedAsReceipt("promo-1", { llm: fakeLlm(), class: "marketing" })).rejects.toMatchObject({ status: 400 });
    await expect(markSkippedAsReceipt("nope", { llm: fakeLlm() })).rejects.toMatchObject({ status: 404 });
  });

  it("without a model it still saves the label, keeps the email listed and says so (503)", async () => {
    await publishUpload(emails(), fakeLlm());
    const failure = await markSkippedAsReceipt("promo-1", { llm: unavailableLlm }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(QualityError);
    expect(failure).toMatchObject({ status: 503, details: { labeled: true } });
    expect(labels.get(scope, "promo-1")?.class).toBe("order");
    expect(getSkippedEmails().map((entry) => entry.emailId)).toContain("promo-1");
  });

  it("applies a saved correction to the next run (the classifier is overridden, the prefilter bypassed)", async () => {
    await publishUpload(emails(), fakeLlm());
    await markSkippedAsReceipt("news-1", { llm: fakeLlm(), now: NOW });
    await markNotReceipt("o1", { now: NOW });
    const { result } = await publishUpload(emails(), fakeLlm());
    expect(result.orders.map((candidate) => candidate.messageIds[0])).toEqual(["news-1"]);
    expect(getSkippedEmails().map((entry) => [entry.emailId, entry.reason])).toEqual([["o1", "marked_not_purchase"], ["promo-1", "marketing"]]);
  });

  it("does not save anything when delete-all ran during the extraction", async () => {
    await publishUpload(emails(), fakeLlm());
    const slow = { ...fakeLlm(), async callTool(request: Parameters<ReturnType<typeof fakeLlm>["callTool"]>[0]) {
      await deleteAll(() => NOW);
      return fakeLlm().callTool(request);
    } };
    await expect(markSkippedAsReceipt("promo-1", { llm: slow })).rejects.toMatchObject({ status: 409 });
    expect(labels.list(scope)).toEqual([]);
  });
});

describe("not a receipt", () => {
  it("removes a single-email order and its findings, saves a label and lists the email as skipped", async () => {
    await publishUpload(emails(), fakeLlm());
    expect(getState().orders).toHaveLength(1);
    const result = await markNotReceipt("o1", { now: NOW });
    expect(result).toMatchObject({ removedOrders: 1, keptSharedOrders: 0, labeled: true });
    const state = getState();
    expect(state.orders).toEqual([]);
    expect(state.findings).toEqual([]);
    expect(state.stats).toMatchObject({ orders: 0, extracted: 0, skipped: 2 });
    expect(labels.get(scope, "o1")).toMatchObject({ class: "not_receipt", source: "feedback", fields: null });
    expect(getSkippedEmails().find((entry) => entry.emailId === "o1")).toMatchObject({ reason: "marked_not_purchase", classConfidence: 1 });
    await expect(markNotReceipt("o1")).rejects.toMatchObject({ status: 409 });
  });

  it("leaves an order that holds several emails in place and says so", async () => {
    const shipped = order("o1b", "NW-1", { subject: "Your order #NW-1 has shipped", text: "Order #NW-1 has shipped. Tracking 1Z999. Order total: $120.00" });
    await publishUpload([order("o1", "NW-1"), shipped], fakeLlm());
    expect(getState().orders).toHaveLength(1);
    expect(getState().orders[0].messageIds.length).toBe(2);
    const result = await markNotReceipt("o1", { now: NOW });
    expect(result).toMatchObject({ removedOrders: 0, keptSharedOrders: 1, labeled: true });
    expect(getState().orders).toHaveLength(1);
    expect(labels.get(scope, "o1")?.class).toBe("not_receipt");
  });
});

describe("review corrections as labels", () => {
  async function reviewable() {
    await publishUpload([order("o1", "NW-1")], fakeLlm());
    const first = getState().orders[0];
    // Review only edits orders flagged for review.
    const flagged = { ...first, needsReview: true, review: { revision: "00000000-0000-4000-8000-000000000001" } };
    setPipelineResult("upload", NOW.toISOString(), { ...{ orders: [flagged], findings: [], reviewQueue: [], stats: getState().stats! } });
    return getState().orders[0];
  }

  it("saves an edit as a label with just the corrected field, and a confirmation with every field", async () => {
    const pending = await reviewable();
    editReviewedOrder(pending.id, pending.review!.revision, { field: "total", value: 99 }, NOW);
    expect(labels.get(scope, "o1")).toMatchObject({ source: "review", class: "order", fields: { totals: { total: 99 } }, redactedText: expect.stringContaining("Order #NW-1") });
    expect(Object.keys(labels.get(scope, "o1")!.fields ?? {})).toEqual(["totals"]);

    const edited = getState().orders[0];
    editReviewedOrder(edited.id, edited.review!.revision, { field: "merchantName", value: "Northwind" }, NOW);
    expect(labels.get(scope, "o1")?.fields).toEqual({ totals: { total: 99 }, merchant: "Northwind" });

    const again = getState().orders[0];
    confirmReviewedOrder(again.id, again.review!.revision, NOW);
    const confirmed = labels.get(scope, "o1")!;
    expect(confirmed.fields).toMatchObject({ merchant: "Northwind", orderRef: "NW-1", currency: "USD", totals: { total: 99 } });
    expect(confirmed.fields?.lineItems).toHaveLength(1);
  });

  it("stores no label for orders without kept text and never throws", async () => {
    const pending = await reviewable();
    getQualityData().texts.clear();
    expect(recordReviewLabel(pending, "confirm")).toBe(false);
    const broken = { ...createLabelStore(":memory:"), upsert() { throw new Error("disk full"); } } as LabelStore;
    getQualityData().texts.set("o1", { emailId: "o1", fromName: null, fromDomain: null, subject: "s", date: NOW.toISOString(), text: "t", textHash: "h", redactions: {}, classification: null, outcome: "extracted" });
    expect(recordReviewLabel(pending, "confirm", undefined, { labels: broken })).toBe(false);
  });
});

describe("delete-all", () => {
  it("clears quality data and the scope's labels, and leaves other scopes alone", async () => {
    await publishUpload(emails(), fakeLlm());
    await markSkippedAsReceipt("promo-1", { llm: fakeLlm(), now: NOW });
    labels.upsert("someone-else", { ...labels.get(scope, "promo-1")! });
    appendAudit({ at: NOW.toISOString(), type: "approval", detail: "x" });
    const result = await deleteAll(() => NOW);
    expect(result.ok).toBe(true);
    expect(getQualityReports()).toEqual({ latest: null, history: [] });
    expect(getSkippedEmails()).toEqual([]);
    expect(getQualityData().texts.size).toBe(0);
    expect(labels.list(scope)).toEqual([]);
    expect(labels.list("someone-else")).toHaveLength(1);
    expect(getState().audit[0].detail).toContain("1 quality labels");
  });

  it("uses the signed-in profile's scope", async () => {
    await withStoreScope("user-1", async () => {
      await publishUpload(emails(), fakeLlm());
      await markSkippedAsReceipt("promo-1", { llm: fakeLlm(), now: NOW });
    });
    expect(labels.list("user-1")).toHaveLength(1);
    expect(labels.list(scope)).toEqual([]);
    await withStoreScope("user-1", () => deleteAll(() => NOW));
    expect(labels.list("user-1")).toEqual([]);
  });
});
