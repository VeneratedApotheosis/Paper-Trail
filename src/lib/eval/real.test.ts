import { describe, expect, it } from "vitest";
import type { Extraction } from "@/lib/contracts";
import { createMemoryCache } from "@/lib/ingestion";
import { extractionInput, fakeLlm } from "@/lib/quality/test-helpers";
import type { QualityLabel } from "@/lib/quality/types";
import { extract } from "@/lib/ingestion";
import { runRealEval } from "./real";

const base = { source: "feedback" as const, redactedText: "", textHash: "", date: "2026-10-01T10:00:00.000Z", at: "2026-10-17T10:00:00.000Z" };
const receipt = (emailId: string, extra: Partial<QualityLabel> = {}): QualityLabel => ({
  ...base, emailId, class: "order", fields: null, subject: "Order confirmation #NW-1", from: '"Northwind" <sender@northwind.example>',
  redactedText: "Thanks for your order! Order #NW-1\nOrder total: $120.00", textHash: `h-${emailId}`, ...extra,
});
const newsletter = (emailId: string, extra: Partial<QualityLabel> = {}): QualityLabel => ({
  ...base, emailId, class: "not_receipt", fields: null, subject: "Autumn journal", from: '"Journal" <sender@oakhaven.example>',
  redactedText: "Five ways to layer textures. Unsubscribe any time.", textHash: `h-${emailId}`, ...extra,
});

describe("runRealEval classification", () => {
  it("scores the receipt gate: precision and recall against labels", async () => {
    const labels = [
      receipt("tp"),
      // Labeled a receipt but nothing in it looks like one: the gate misses it (false negative).
      receipt("fn", { subject: "Hello", redactedText: "Your parcel from the shop, thanks" }),
      newsletter("tn"),
      // Labeled not a receipt although it reads like one (false positive).
      newsletter("fp", { from: '"Northwind" <sender@northwind.example>', subject: "Order confirmation #NW-7", redactedText: "Thanks for your order! Order #NW-7\nOrder total: $9.00" }),
    ];
    const { classification, counts } = await runRealEval(labels);
    expect(classification).toMatchObject({ total: 4, truePositives: 1, falsePositives: 1, falseNegatives: 1, trueNegatives: 1, precision: 0.5, recall: 0.5, f1: 0.5, accuracy: 0.5 });
    expect(classification.mistakes.map((mistake) => mistake.emailId).sort()).toEqual(["fn", "fp"]);
    expect(counts).toEqual({ labels: 4, bySource: { review: 0, feedback: 4 }, receipts: 2, notReceipts: 2, withFields: 0 });
  });

  it("handles an empty label set", async () => {
    const report = await runRealEval([]);
    expect(report.classification).toMatchObject({ total: 0, precision: 0, recall: 0, accuracy: 0 });
    expect(report.extraction).toEqual({ status: "not_run", reason: "no extractor or cache supplied" });
  });
});

describe("runRealEval extraction", () => {
  const labeled = (emailId: string, total: number, ref = "NW-1") => receipt(emailId, {
    source: "review", textHash: `h-${emailId}`, redactedText: `Order #${ref}\nOrder total: $${total}.00`,
    fields: { merchant: "Northwind Outfitters", orderRef: ref, totals: { total } },
  });

  it("scores per-field accuracy from cached extractions and lists labels with none", async () => {
    const cache = createMemoryCache();
    const extraction = (emailId: string, total: number): Extraction => ({
      emailId, class: "order", model: "cached-model", cached: false, confMin: 0.9, confidence: {}, evidence: {},
      ...(extractionInput("NW-1", total) as unknown as Pick<Extraction, "fields">),
    });
    cache.set("h-a", extraction("a", 120)); // right
    cache.set("h-b", extraction("b", 100)); // total wrong
    const report = await runRealEval([labeled("a", 120), labeled("b", 120), labeled("c", 120)], { cache });
    if (report.extraction.status !== "ok") throw new Error("expected ok");
    expect(report.extraction).toMatchObject({ labelsScored: 2, models: ["cached-model"], overallAccuracy: 5 / 6 });
    expect(report.extraction.perField.totals).toMatchObject({ correct: 1, total: 2, accuracy: 0.5 });
    expect(report.extraction.perField.merchant?.accuracy).toBe(1);
    expect(report.extraction.unscored).toEqual([{ emailId: "c", reason: "no cached extraction for this email" }]);
    expect(report.extraction.mismatches).toEqual([expect.objectContaining({ emailId: "b", field: "totals" })]);
  });

  it("uses a chosen extractor instead of the cache, and ignores class-only labels", async () => {
    const llm = fakeLlm("alt-model", { total: 120 });
    const extractor = (email: Parameters<typeof extract>[0], classification: Parameters<typeof extract>[1]) => extract(email, classification, { llm });
    const report = await runRealEval([labeled("a", 120), receipt("class-only")], { extractor, cache: createMemoryCache() });
    if (report.extraction.status !== "ok") throw new Error("expected ok");
    expect(report.extraction).toMatchObject({ labelsScored: 1, models: ["alt-model"], overallAccuracy: 1 });
    expect(llm.requests).toHaveLength(1);
    expect(report.counts.withFields).toBe(1);
  });

  it("reports an extractor failure as unscored instead of throwing", async () => {
    const report = await runRealEval([labeled("a", 120)], { extractor: async () => { throw new Error("boom"); } });
    if (report.extraction.status !== "ok") throw new Error("expected ok");
    expect(report.extraction.labelsScored).toBe(0);
    expect(report.extraction.unscored).toEqual([{ emailId: "a", reason: "extraction failed" }]);
  });
});
