import { describe, expect, it } from "vitest";
import {
  ExpectedFindingsFileSchema,
  GoldLabelsFileSchema,
  type Extraction,
  type RawEmail,
} from "@/lib/contracts";
import { createSeedExtractor, seedInbox, seedPriceFeed } from "@/lib/demo/seed";
import expectedJson from "../../../seed/expected_findings.json";
import goldJson from "../../../seed/gold_labels.json";
import { runPipeline, type PipelineAuditEvent, type PipelineExtractor } from "./run";

const expected = ExpectedFindingsFileSchema.parse(expectedJson);
const gold = GoldLabelsFileSchema.parse(goldJson);

async function runSeed(options: { excludedMerchants?: Set<string> } = {}) {
  const audit: PipelineAuditEvent[] = [];
  const result = await runPipeline(seedInbox.emails, {
    now: new Date(seedInbox.asOf),
    priceFeed: seedPriceFeed,
    extractor: createSeedExtractor({ seedCache: null, audit: (event) => audit.push(event) }),
    audit: (event) => audit.push(event),
    applyPrefilter: true,
    excludedMerchants: options.excludedMerchants,
  });
  return { ...result, audit };
}

const email: RawEmail = {
  id: "upload-1",
  from: '"Northwind Outfitters" <orders@northwind.example>',
  subject: "Order confirmation #NW-9001",
  date: "2026-10-01T10:00:00Z",
  text: "Thanks for your order #NW-9001.\nOrder total: $40.00",
};

function lowConfidenceExtraction(emailId: string): Extraction {
  return {
    emailId,
    class: "order",
    fields: { merchant: "Northwind Outfitters", orderRef: "NW-9001", date: "2026-10-01", currency: "USD", lineItems: [], totals: { total: 40 } },
    confidence: { merchant: 0.5, orderRef: 0.9, date: 0.9, currency: 0.9, totals: 0.9 },
    evidence: {},
    confMin: 0.5,
    model: "test-model",
    cached: false,
  };
}

describe("runPipeline on the synthetic seed (gold extractions)", () => {
  it("reproduces every expected finding with matching amounts", async () => {
    const { orders, findings } = await runSeed();
    expect(findings).toHaveLength(expected.findings.length);
    for (const want of expected.findings) {
      const match = findings.filter((finding) => {
        const order = orders.find((candidate) => candidate.id === finding.orderId);
        const item = order?.lineItems.find((candidate) => candidate.id === finding.lineItemId);
        return (
          finding.kind === want.kind &&
          order?.merchant.name === want.merchant &&
          order.orderRef === want.orderRef &&
          (want.lineItem === undefined || item?.name === want.lineItem)
        );
      });
      expect(match, `${want.kind} ${want.orderRef}`).toHaveLength(1);
      expect(match[0].amountAtStake).toBeCloseTo(want.amountAtStake, 2);
      if (want.dueDate) expect(match[0].dueAt?.slice(0, 10)).toBe(want.dueDate);
    }
  });

  it("keeps phishing and marketing emails out of every order", async () => {
    const { orders } = await runSeed();
    const ignored = gold.labels.filter((label) => label.class === "marketing" || label.class === "not_receipt");
    expect(ignored.some((label) => label.tags.includes("phishing_lookalike"))).toBe(true);
    const used = new Set(orders.flatMap((order) => order.messageIds));
    for (const label of ignored) expect(used.has(label.emailId), label.emailId).toBe(false);
    expect(orders.some((order) => order.merchant.domain?.includes("n0rthwind"))).toBe(false);
  });

  it("reports stats and labels every extraction as precomputed gold, not LLM output", async () => {
    const { stats, audit } = await runSeed();
    expect(stats.emails).toBe(seedInbox.emails.length);
    expect(stats.extractionOrigins).toEqual({ llm: 0, cache: 0, gold: stats.extracted });
    expect(stats.findings).toBe(expected.findings.length);
    const extractionAudits = audit.filter((event) => event.type === "llm_call");
    expect(extractionAudits).toHaveLength(stats.extracted);
    for (const event of extractionAudits) {
      expect(event.model).toBe("gold");
      expect(event.detail).toMatch(/Precomputed .* no LLM call/);
    }
    expect(audit[0].type).toBe("sync_start");
    expect(audit.at(-1)?.type).toBe("sync_complete");
  });

  it("never puts email bodies in audit events", async () => {
    const { audit } = await runSeed();
    const serialized = JSON.stringify(audit);
    const bodyLines = seedInbox.emails.flatMap((seedEmail) =>
      seedEmail.text.split("\n").map((line) => line.trim()).filter((line) => line.length >= 25),
    );
    expect(bodyLines.length).toBeGreaterThan(100);
    for (const line of bodyLines) expect(serialized.includes(line), line).toBe(false);
  });

  it("drops excluded merchants' orders before rules run", async () => {
    const { orders, findings, stats } = await runSeed({ excludedMerchants: new Set(["northwind outfitters"]) });
    expect(orders.some((order) => order.merchant.name === "Northwind Outfitters")).toBe(false);
    expect(stats.excludedOrders).toBeGreaterThan(0);
    expect(findings.length).toBeLessThan(expected.findings.length);
  });
});

describe("runPipeline review queue", () => {
  const base = { now: new Date("2026-10-17T00:00:00Z") };

  it("routes extractor failures to the review queue instead of dropping them", async () => {
    const extractor: PipelineExtractor = async () => {
      throw new Error("ANTHROPIC_API_KEY is not set");
    };
    const result = await runPipeline([email], { ...base, extractor });
    expect(result.orders).toEqual([]);
    expect(result.reviewQueue).toEqual([
      { emailId: "upload-1", stage: "extract", reason: "extraction failed: Error: ANTHROPIC_API_KEY is not set" },
    ]);
  });

  it("routes needs-review extraction results to the review queue", async () => {
    const extractor: PipelineExtractor = async () => ({ ok: false, needsReview: true, reason: "invalid after retry" });
    const result = await runPipeline([email], { ...base, extractor });
    expect(result.reviewQueue).toEqual([{ emailId: "upload-1", stage: "extract", reason: "invalid after retry" }]);
  });

  it("flags low-confidence extractions and their orders, which produce no findings", async () => {
    const extractor: PipelineExtractor = async (redacted) => ({ ok: true, extraction: lowConfidenceExtraction(redacted.id) });
    const result = await runPipeline([email], { ...base, extractor });
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].needsReview).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.reviewQueue.map((item) => item.stage)).toEqual(["extract", "match"]);
    expect(result.reviewQueue[1].orderId).toBe(result.orders[0].id);
    expect(result.stats.extractionOrigins).toEqual({ llm: 1, cache: 0, gold: 0 });
  });

  it("never calls the extractor for phishing or marketing", async () => {
    const calls: string[] = [];
    const extractor: PipelineExtractor = async (redacted) => {
      calls.push(redacted.id);
      return { ok: false, skipped: true, reason: "test" };
    };
    const phishing: RawEmail = {
      id: "phish-1",
      from: '"Northwind Outfitters" <support@n0rthwind-support.example>',
      subject: "Your order #NW-1234 is on hold",
      date: "2026-10-01T10:00:00Z",
      text: "Verify your card details to release your order.",
    };
    const promo: RawEmail = {
      id: "promo-1",
      from: '"Northwind" <news@northwind.example>',
      subject: "30% off everything",
      date: "2026-10-01T10:00:00Z",
      text: "Shop now, limited-time sale. Unsubscribe here.",
    };
    const result = await runPipeline([phishing, promo], { ...base, extractor });
    expect(calls).toEqual([]);
    expect(result.stats.skipped).toBe(2);
    expect(result.orders).toEqual([]);
  });

  it("applies the receipt prefilter only when asked", async () => {
    const note: RawEmail = { ...email, id: "note-1", from: "friend@mail.example", subject: "lunch?", text: "See you at noon" };
    const extractor: PipelineExtractor = async () => ({ ok: false, skipped: true, reason: "test" });
    const filtered = await runPipeline([note], { ...base, extractor, applyPrefilter: true });
    expect(filtered.stats.prefilteredOut).toBe(1);
    const unfiltered = await runPipeline([note], { ...base, extractor });
    expect(unfiltered.stats.prefilteredOut).toBe(0);
    expect(unfiltered.stats.classes.not_receipt).toBe(1);
  });
});
