import { describe, expect, it, vi } from "vitest";
import { createMemoryCache } from "@/lib/ingestion";
import type { LlmClient } from "@/lib/llm";
import type { PipelineAuditEvent } from "@/lib/pipeline/run";
import { MAX_EXPERIMENT_LABELS, PROMPT_VARIANTS, experimentLabels, runExperiment } from "./experiment";
import { fakeLlm, unavailableLlm } from "./test-helpers";
import type { QualityLabel } from "./types";

const labeled = (emailId: string, total = 120, extra: Partial<QualityLabel> = {}): QualityLabel => ({
  emailId, source: "review", class: "order", redactedText: `Order #NW-${emailId}\nOrder total: $${total}.00`, textHash: `h-${emailId}`,
  subject: `Order #NW-${emailId}`, from: '"Northwind" <sender@northwind.example>', date: "2026-10-01T10:00:00.000Z", at: "2026-10-17T10:00:00.000Z",
  fields: { merchant: "Northwind Outfitters", orderRef: `NW-${emailId}`, totals: { total } }, ...extra,
});

describe("runExperiment", () => {
  it("runs the candidate model next to the current one without touching the live cache or setting", async () => {
    vi.stubEnv("LLM_MODEL", "claude-haiku-5-5");
    const clients = new Map<string, ReturnType<typeof fakeLlm>>();
    const llmFor = (model: string) => {
      const client = fakeLlm(model, model === "claude-sonnet-5-5" ? { total: 120, usage: { inputTokens: 1000, outputTokens: 500 } } : { total: 99, usage: { inputTokens: 1000, outputTokens: 500 } });
      clients.set(model, client);
      return client;
    };
    const liveCache = createMemoryCache();
    const setSpy = vi.spyOn(liveCache, "set");
    const audit: PipelineAuditEvent[] = [];
    const result = await runExperiment([labeled("1"), labeled("2")], { model: "claude-sonnet-5-5" }, { llmFor, cache: liveCache, audit: (event) => audit.push(event) });

    expect(result).toMatchObject({ labelsAvailable: 2, labelsUsed: 2, capped: false });
    expect(result.warning).toMatch(/calls Claude/);
    expect(result.current).toMatchObject({ model: "claude-haiku-5-5", promptVariant: "default", llmCalls: 2, inputTokens: 2000, outputTokens: 1000, cachedLabels: 0 });
    expect(result.candidate).toMatchObject({ model: "claude-sonnet-5-5", llmCalls: 2, inputTokens: 2000, outputTokens: 1000 });
    // Candidate answered the right totals, current did not: accuracy differs side by side.
    expect(result.candidate!.overallAccuracy).toBeGreaterThan(result.current.overallAccuracy);
    expect(result.candidate!.perField.totals?.accuracy).toBe(1);
    expect(result.current.perField.totals?.accuracy).toBe(0);
    expect(result.current.estimatedCostUsd).toBeCloseTo((2000 * 1 + 1000 * 5) / 1e6);
    expect(result.candidate!.estimatedCostUsd).toBeCloseTo((2000 * 3 + 1000 * 15) / 1e6);
    // The injected model was used for the candidate; nothing was cached or changed.
    expect(clients.get("claude-sonnet-5-5")!.requests).toHaveLength(2);
    expect(setSpy).not.toHaveBeenCalled();
    expect(liveCache.get("h-1")).toBeUndefined();
    expect(process.env.LLM_MODEL).toBe("claude-haiku-5-5");
    // Every call is audited with model and tokens, never text.
    expect(audit.filter((event) => event.type === "llm_call")).toHaveLength(4);
    expect(audit.map((event) => event.model).sort()).toEqual(["claude-haiku-5-5", "claude-haiku-5-5", "claude-sonnet-5-5", "claude-sonnet-5-5"]);
    vi.unstubAllEnvs();
  });

  it("answers the current setting from the live cache where it can (no tokens spent)", async () => {
    const liveCache = createMemoryCache();
    const llm = fakeLlm("cur", { total: 120 });
    const { extract } = await import("@/lib/ingestion");
    const label = labeled("1");
    await extract({ id: "1", from: label.from, subject: label.subject, date: label.date, text: label.redactedText, redactions: { pan: 0, phone: 0, address: 0, email: 0 }, textHash: label.textHash },
      { emailId: "1", class: "order", confidence: 1 }, { llm, cache: liveCache });
    const result = await runExperiment([label], { promptVariant: "conservative" }, { currentModel: "cur", llmFor: (model) => fakeLlm(model), cache: liveCache });
    expect(result.current).toMatchObject({ cachedLabels: 1, llmCalls: 0, inputTokens: 0, overallAccuracy: 1 });
    expect(result.candidate).toMatchObject({ model: "cur", promptVariant: "conservative", llmCalls: 1 });
  });

  it("sends the prompt variant's instructions with the system prompt", async () => {
    const client = fakeLlm("m");
    await runExperiment([labeled("1")], { promptVariant: "itemized" }, { currentModel: "m", llmFor: () => client });
    const systems = client.requests.map((request) => request.system);
    expect(systems.filter((system) => system.includes(PROMPT_VARIANTS.itemized.addendum))).toHaveLength(1);
    expect(systems.filter((system) => !system.includes(PROMPT_VARIANTS.itemized.addendum))).toHaveLength(1);
  });

  it("returns no candidate when the request equals the current setting", async () => {
    const result = await runExperiment([labeled("1")], { model: "m" }, { currentModel: "m", llmFor: (model) => fakeLlm(model) });
    expect(result.candidate).toBeNull();
  });

  it("is bounded to 50 labels, newest first, and ignores labels it cannot score", async () => {
    const many = Array.from({ length: 60 }, (_, index) => labeled(String(index)));
    const withNoise = [labeled("class-only", 1, { fields: null }), labeled("junk", 1, { class: "not_receipt" }), ...many];
    expect(experimentLabels(withNoise)).toMatchObject({ available: 60 });
    const llm = fakeLlm("m");
    const result = await runExperiment(withNoise, {}, { currentModel: "m", llmFor: () => llm });
    expect(result).toMatchObject({ labelsAvailable: 60, labelsUsed: MAX_EXPERIMENT_LABELS, capped: true });
    expect(llm.requests).toHaveLength(MAX_EXPERIMENT_LABELS);
    expect(llm.requests[0].user).toContain("#NW-0");
  });

  it("refuses when there are no labels with corrected fields (400) or no model access (503)", async () => {
    await expect(runExperiment([labeled("1", 1, { fields: null })], {})).rejects.toMatchObject({ status: 400 });
    await expect(runExperiment([labeled("1")], {}, { currentModel: "m", llmFor: () => unavailableLlm as LlmClient })).rejects.toMatchObject({ status: 503 });
  });
});
