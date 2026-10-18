import { describe, expect, it } from "vitest";
import type { RawEmail } from "@/lib/contracts";
import { createMemoryCache } from "@/lib/ingestion";
import { createLlmExtractor } from "./extractors";
import { runPipeline, type PipelineAuditEvent } from "./run";
import { fakeLlm, order } from "@/lib/quality/test-helpers";

// #125: the redaction switch decides what the LLM sees; every call is audited either way.
const NOW = new Date("2026-10-17T12:00:00Z");
const raw: RawEmail = { ...order("o1", "NW-1"), html: "<p>html body</p>" };

describe.each([
  { mode: "on" as const, sentPhone: false, redactedTokens: true },
  { mode: "off" as const, sentPhone: true, redactedTokens: false },
])("runPipeline with redaction $mode", ({ mode, sentPhone, redactedTokens }) => {
  it("sends the prepared text to the LLM and writes an llm_call audit row", async () => {
    const llm = fakeLlm("m", { total: 120 });
    const audit: PipelineAuditEvent[] = [];
    const result = await runPipeline([raw], {
      now: NOW,
      redaction: mode,
      extractor: createLlmExtractor({ cache: createMemoryCache(), llm, audit: (event) => audit.push(event) }),
      audit: (event) => audit.push(event),
    });
    expect(result.orders).toHaveLength(1);
    const sent = llm.requests[0].user;
    expect(sent.includes("555-012-3456")).toBe(sentPhone);
    expect(sent.includes("[PHONE_1]")).toBe(redactedTokens);
    expect(sent).not.toContain("html body");
    const calls = audit.filter((event) => event.type === "llm_call");
    expect(calls).toHaveLength(1);
    expect(calls[0].redactedTokenCount).toBe(redactedTokens ? 1 : 0);
  });
});
