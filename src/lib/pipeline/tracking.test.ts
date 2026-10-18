import { describe, expect, it } from "vitest";
import type { ExtractResult } from "@/lib/ingestion";
import { extract } from "@/lib/ingestion";
import { EXTRACTION_TOOL_NAME } from "@/lib/ingestion/extract-prompt";
import { createMemoryCache } from "@/lib/ingestion/cache";
import { prepareForLlm } from "@/lib/ingestion";
import type { LlmClient } from "@/lib/llm";
import { matchOrders } from "@/lib/orders/matcher";
import { TRACKING_SPECS, extractionOfTracking, rawEmailOfTracking, trackingInputs, trackingSpec } from "@/lib/orders/tracking-fixtures";
import { defaultRules, runRulesIsolated } from "@/lib/rules";
import { mergeAccountResults } from "./accounts";
import { runPipeline, type PipelineExtractor, type PipelineResult } from "./run";
import { stats } from "./accounts.fixtures";

const NOW = new Date("2026-11-01T00:00:00Z");

const fixtureExtractor: PipelineExtractor = async (redacted, classification): Promise<ExtractResult> => {
  const spec = TRACKING_SPECS.find((candidate) => candidate.id === redacted.id)!;
  return { ok: true, extraction: { ...extractionOfTracking(spec), class: classification.class } };
};

const emailsOf = (...ids: string[]) => ids.map((id) => ({ ...rawEmailOfTracking(trackingSpec(id)) }));

describe("pipeline with tracking emails (#127)", () => {
  it("links lifecycle emails to the receipt, reports linked vs orphaned and counts orders by kind", async () => {
    const result = await runPipeline(
      emailsOf("bkb-confirmed", "bkb-shipped", "bkb-out", "bkb-delivered", "shopee-1", "shopee-2", "tea-order", "tea-shipped"),
      { now: NOW, extractor: fixtureExtractor },
    );
    expect(result.orders).toHaveLength(3);
    expect(result.stats.lifecycle).toEqual({ linked: 4, orphaned: 2 });
    expect(result.stats.kinds).toEqual({ shipped: 3 });
    expect(result.stats.classes).toMatchObject({ order: 2, shipped: 5, delivered: 1 });
    expect(result.stats.dedup?.merges.tracking_number).toBeGreaterThanOrEqual(2);
    const pkg = result.orders.find((order) => order.packageOnly);
    // A tracking-only entry has no amount ($0), so it waits in Review rather than showing as a $0.00 purchase.
    expect(pkg?.needsReview).toBe(true);
    // The package entry is not in the needs-review queue and produces no findings.
    expect(result.reviewQueue.filter((item) => item.orderId === pkg?.id).map((item) => item.reason)).toEqual([expect.stringContaining("no receipt")]);
    expect(result.findings.filter((finding) => finding.orderId === pkg?.id)).toEqual([]);
  });

  it("the receipt arriving in a later sync absorbs the package entry (same inbox, whole window re-run)", async () => {
    const first = await runPipeline(emailsOf("pkg-shipped", "pkg-out", "pkg-delivered"), { now: NOW, extractor: fixtureExtractor });
    expect(first.orders).toEqual([expect.objectContaining({ packageOnly: true, total: 0 })]);
    const later = await runPipeline(emailsOf("pkg-shipped", "pkg-out", "pkg-delivered", "pkg-receipt"), { now: NOW, extractor: fixtureExtractor });
    expect(later.orders).toHaveLength(1);
    expect(later.orders[0]).toMatchObject({ total: 46, orderRef: "LB-7001" });
    expect(later.orders[0].packageOnly).toBeUndefined();
  });
});

describe("package-only entries across linked accounts", () => {
  function accountResult(ids: string[], account: string): PipelineResult {
    const inputs = trackingInputs(...ids).map((input) => ({ ...input, email: { ...input.email, sourceAccount: account } }));
    const orders = matchOrders(inputs);
    const { findings } = runRulesIsolated(orders, defaultRules, { now: NOW });
    return { orders, findings, reviewQueue: [], stats: stats({ orders: orders.length, kinds: { shipped: orders.length } }) };
  }

  it("joins a package-only entry of one inbox to the receipt in the other through the tracking number", () => {
    const a = accountResult(["pkg-shipped", "pkg-out", "pkg-delivered"], "acct-a");
    const b = accountResult(["pkg-receipt"], "acct-b");
    expect(a.orders[0].packageOnly).toBe(true);
    const merged = mergeAccountResults([{ accountId: "acct-a", asOf: NOW.toISOString(), result: a }, { accountId: "acct-b", asOf: NOW.toISOString(), result: b }], NOW).result;
    expect(merged.orders).toHaveLength(1);
    expect(merged.orders[0]).toMatchObject({ total: 46, kind: "shipped", sources: ["acct-a", "acct-b"] });
    expect(merged.orders[0].packageOnly).toBeUndefined();
    expect(merged.stats.kinds).toEqual({ shipped: 1 });
  });
});

describe("extraction of kind details (#127)", () => {
  const redacted = prepareForLlm(rawEmailOfTracking(trackingSpec("bkb-shipped")), "off");
  const classification = { emailId: redacted.id, class: "shipped" as const, confidence: 0.9 };
  const llmReturning = (...inputs: unknown[]): LlmClient & { calls: number } => {
    const client = {
      model: "fake", calls: 0,
      async callTool() {
        const toolInput = inputs[client.calls];
        client.calls += 1;
        return { toolInput, text: "", usage: { inputTokens: 1, outputTokens: 1 }, model: "fake" };
      },
    };
    return client;
  };
  const toolInput = (fields: Record<string, unknown>) => ({
    fields: { merchant: "Bowl Keyboards", orderRef: null, date: "2026-09-23", currency: null, lineItems: [], totals: {}, ...fields },
    confidence: { merchant: 0.9, date: 0.9 },
    evidence: { merchant: "Bowl Keyboards" },
  });

  it("accepts shipment details and keeps tracking URLs out of the schema", async () => {
    const llm = llmReturning(toolInput({ kindGuess: "shipped", shipment: { carrier: "UPS", trackingNumbers: ["1Z999AA10123456784"], status: "out_for_delivery", eta: "2026-09-25", pickupLocation: null, trackingUrl: "https://evil.example" } }));
    const result = await extract(redacted, classification, { llm, cache: createMemoryCache() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.extraction.fields.shipment).toMatchObject({ carrier: "UPS", trackingNumbers: ["1Z999AA10123456784"], status: "out_for_delivery" });
    expect(JSON.stringify(result.extraction)).not.toContain("evil.example");
    expect(result.extraction.confMin).toBe(0.9); // unscored details never lower the confidence
    expect(llm.calls).toBe(1);
  });

  it("repairs malformed secondary details instead of failing the extraction", async () => {
    const llm = llmReturning(toolInput({ kindGuess: "teleport", shipment: { trackingNumbers: ["  A123456789 ", 7, "", "A123456789"], status: "flying" }, subscription: { interval: "fortnight" }, travel: { segments: [{ label: "" }, { label: "TPE-NRT", start: "2026-11-02" }, "bad"] } }));
    const result = await extract(redacted, classification, { llm });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.extraction.fields).toMatchObject({
      kindGuess: null,
      shipment: { trackingNumbers: ["A123456789"], status: null },
      subscription: { interval: null },
      travel: { segments: [{ label: "TPE-NRT", start: "2026-11-02", end: null }] },
    });
    expect(llm.calls).toBe(1);
  });

  it("still retries once on an invalid primary field, then routes to review", async () => {
    const llm = llmReturning(toolInput({ currency: "dollars" }), toolInput({ currency: "dollars" }));
    const result = await extract(redacted, classification, { llm });
    expect(result).toMatchObject({ ok: false, needsReview: true });
    expect(llm.calls).toBe(2);
    expect(EXTRACTION_TOOL_NAME).toBe("record_extraction");
  });
});
