import { describe, expect, it, vi } from "vitest";
import { runUploadPipeline } from "@/lib/demo";
import { createMemoryCache } from "@/lib/ingestion";
import { LlmHttpError, type LlmClient } from "@/lib/llm";
import type { PipelineAuditEvent } from "@/lib/pipeline/run";
import { createSyncCollector } from "./collector";
import { NEWSLETTER, NOW, PROMO, fakeLlm, order, unavailableLlm } from "./test-helpers";

// The stored-text test asserts redaction; the default switch is off (#125).
vi.stubEnv("PAPERTRAIL_REDACT", "on");

async function collect(emails = [order("o1", "NW-1"), order("o2", "NW-2"), NEWSLETTER, PROMO], llm = fakeLlm()) {
  const collector = createSyncCollector({ source: "upload", clock: () => NOW });
  const result = await runUploadPipeline(emails, {
    cache: createMemoryCache(), now: NOW, llm, observer: collector.observe, onUsage: collector.recordUsage,
  });
  return { result, collected: collector.finish(result, { bodySource: { plain: 4, html: 0 } }) };
}

describe("sync quality collector", () => {
  it("counts what the pipeline did and the LLM usage of the run", async () => {
    const { collected, result } = await collect();
    expect(collected.report).toMatchObject({
      at: NOW.toISOString(), source: "upload", fetched: 4, prefilteredOut: 1, skippedNonReceipt: 1, extracted: 2,
      lowConfidence: 0, extractionFailures: 0, matchedOrders: 2, findings: result.stats.findings,
      llmCalls: 2, inputTokens: 200, outputTokens: 100, bodySource: { plain: 4, html: 0 },
    });
    expect(collected.report.classified).toEqual(result.stats.classes);
    expect(collected.report.accountId).toBeUndefined();
  });

  it("does not count cache hits as LLM calls", async () => {
    const cache = createMemoryCache();
    const run = async () => {
      const collector = createSyncCollector({ source: "upload" });
      const result = await runUploadPipeline([order("o1", "NW-1")], { cache, now: NOW, llm: fakeLlm(), observer: collector.observe, onUsage: collector.recordUsage });
      return collector.finish(result).report;
    };
    expect((await run()).llmCalls).toBe(1);
    expect(await run()).toMatchObject({ llmCalls: 0, inputTokens: 0, extracted: 1 });
  });

  it("counts failed extractions and low confidence separately", async () => {
    const { collected } = await collect([order("o1", "NW-1")], unavailableLlm as never);
    expect(collected.report).toMatchObject({ extracted: 0, extractionFailures: 1, llmCalls: 0, inputTokens: 0 });
  });

  it("counts a failed provider request as an LLM call, but a missing API key as none, in the report and the audit log", async () => {
    const run = async (llm: LlmClient) => {
      const collector = createSyncCollector({ source: "upload" });
      const audit: PipelineAuditEvent[] = [];
      const result = await runUploadPipeline([order("o1", "NW-1")], {
        cache: createMemoryCache(), now: NOW, llm, audit: (event) => audit.push(event), observer: collector.observe, onUsage: collector.recordUsage,
      });
      return { report: collector.finish(result).report, llmCallRows: audit.filter((event) => event.type === "llm_call").length };
    };
    const failing: LlmClient = { model: "m", callTool: async () => { throw new LlmHttpError(503, "provider"); } };
    expect(await run(failing)).toMatchObject({ report: { llmCalls: 1, extractionFailures: 1 }, llmCallRows: 1 });
    expect(await run(unavailableLlm)).toMatchObject({ report: { llmCalls: 0, extractionFailures: 1 }, llmCallRows: 0 });
  });

  it("lists skipped emails with safe metadata and a reason", async () => {
    const { collected } = await collect();
    const byId = Object.fromEntries(collected.skipped.map((entry) => [entry.emailId, entry]));
    expect(Object.keys(byId).sort()).toEqual(["news-1", "promo-1"]);
    expect(byId["news-1"]).toMatchObject({
      reason: "prefilter", classConfidence: null, from: { name: "The Oakhaven Journal", domain: "oakhaven.example" },
      subject: NEWSLETTER.subject, date: NEWSLETTER.date,
    });
    expect(byId["promo-1"]).toMatchObject({ reason: "marketing", from: { domain: "northwind.example" } });
    expect(byId["promo-1"].classConfidence).toBeGreaterThan(0);
    // Only metadata: no body text, no addresses.
    const serialized = JSON.stringify(collected.skipped);
    expect(serialized).not.toContain("Unsubscribe");
    expect(serialized).not.toContain("@");
  });

  it("keeps redacted text only: no raw addresses, phone numbers or `to` header", async () => {
    const { collected } = await collect();
    const serialized = JSON.stringify(collected.texts);
    expect(serialized).not.toContain("sam.rivera@mail.example");
    expect(serialized).not.toContain("orders@northwind.example");
    expect(serialized).not.toContain("555-012-3456");
    expect(collected.texts.find((text) => text.emailId === "o1")).toMatchObject({
      fromName: "Northwind Outfitters", fromDomain: "northwind.example", outcome: "extracted",
    });
    expect(collected.texts.find((text) => text.emailId === "o1")?.text).toContain("[PHONE_1]");
    expect(collected.texts.find((text) => text.emailId === "news-1")?.outcome).toBe("prefiltered");
  });
});
