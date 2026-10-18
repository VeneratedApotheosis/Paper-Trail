import { describe, expect, it } from "vitest";
import type { RawEmail } from "@/lib/contracts";
import { extractionOf } from "@/lib/orders/dedup/dedup-fixtures";
import { createLlmExtractor } from "./extractors";
import { createMemoryCache } from "@/lib/ingestion";
import { runPipeline, type PipelineEmailObservation, type PipelineExtractor } from "./run";
import { fakeLlm } from "@/lib/quality/test-helpers";

// Exact copies are collapsed BEFORE extraction (#126 A): no LLM call for them, provenance kept.
const NOW = new Date("2026-10-17T12:00:00Z");
const base: RawEmail = {
  id: "g-1", from: '"Northwind Outfitters" <orders@northwind.example>', subject: "Order confirmation #NW-1001",
  date: "2026-10-01T10:00:00Z", text: "Thanks for your order #NW-1001.\nRain Jacket x1 $80.00\nOrder total: $80.00",
  messageId: "<nw-1001@northwind.example>",
};

describe("runPipeline exact-copy collapse", () => {
  it("spends no LLM call on a copy, keeps both Gmail ids, and reports the collapse", async () => {
    const llm = fakeLlm("m", { total: 80 });
    const observed: PipelineEmailObservation[] = [];
    const result = await runPipeline([base, { ...base, id: "g-2", messageId: "NW-1001@NORTHWIND.example" }], {
      now: NOW, redaction: "off", extractor: createLlmExtractor({ cache: createMemoryCache(), llm }), observer: (item) => observed.push(item),
    });
    expect(llm.requests).toHaveLength(1);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].messageIds).toEqual(["g-1", "g-2"]);
    expect(result.orders[0].emailKeys).toContain("mid:nw-1001@northwind.example");
    expect(result.stats).toMatchObject({ emails: 2, extracted: 1, orders: 1, dedup: { emailsCollapsed: 1, merges: { message_id: 1 }, possibleDuplicates: 0 } });
    expect(observed.map((item) => item.outcome)).toEqual(["extracted", "collapsed"]);
    expect(result.reviewQueue).toEqual([]);
  });

  it("does not collapse look-alike emails with different Message-IDs (two identical coffees)", async () => {
    const coffee = (id: string, messageId: string, date: string): RawEmail => ({
      id, from: '"Brewbox" <orders@brewbox.example>', subject: "Your receipt", date, messageId, text: "Flat White $4.50\nTotal $4.50",
    });
    const extractor: PipelineExtractor = async (_email, _classification, raw) => ({
      ok: true,
      extraction: extractionOf({ id: raw.id, scenario: "x", purchase: raw.id, merchant: "Brewbox Coffee", domain: "brewbox.example", ref: null, date: raw.date, total: 4.5, items: [["Flat White", 1, 4.5]] }),
    });
    const result = await runPipeline([coffee("c1", "a@brewbox.example", "2026-10-01T08:00:00Z"), coffee("c2", "b@brewbox.example", "2026-10-01T09:00:00Z")], {
      now: NOW, redaction: "off", extractor, classOverride: () => "order",
    });
    expect(result.orders).toHaveLength(2);
    expect(result.stats.dedup).toMatchObject({ emailsCollapsed: 0, possibleDuplicates: 1 });
  });

  it("collapses identical bodies seen through two linked inboxes in one run, keeping both sources", async () => {
    const llm = fakeLlm("m", { total: 80 });
    const result = await runPipeline(
      [{ ...base, messageId: undefined, sourceAccount: "acct-a" }, { ...base, id: "g-2", messageId: undefined, sourceAccount: "acct-b" }],
      { now: NOW, redaction: "off", extractor: createLlmExtractor({ cache: createMemoryCache(), llm }) },
    );
    expect(llm.requests).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({ messageIds: ["g-1", "g-2"], sources: ["acct-a", "acct-b"] });
    expect(result.stats.dedup?.merges).toEqual({ fingerprint: 1 });
  });
});
