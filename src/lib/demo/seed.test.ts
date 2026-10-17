import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GoldLabelsFileSchema } from "@/lib/contracts";
import { redact } from "@/lib/ingestion";
import { extractionFromGoldLabel } from "@/lib/pipeline/gold";
import type { PipelineAuditEvent } from "@/lib/pipeline/run";
import goldJson from "../../../seed/gold_labels.json";
import { loadSeedDemo, seedInbox } from "./seed";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pt-seed-"));
  tempDirs.push(dir);
  return join(dir, name);
}

describe("loadSeedDemo", () => {
  it("falls back to precomputed gold extractions when no seed LLM cache exists", async () => {
    const audit: PipelineAuditEvent[] = [];
    const result = await loadSeedDemo({ cachePath: tempPath("missing.json"), audit: (event) => audit.push(event) });
    expect(result.asOf).toBe(seedInbox.asOf);
    expect(result.simulatedPriceFeed).toBe(true);
    expect(result.findings).toHaveLength(14);
    expect(result.stats.extractionOrigins.cache).toBe(0);
    expect(result.stats.extractionOrigins.gold).toBe(result.stats.extracted);
    expect(result.reviewQueue).toEqual([]);
    expect(audit.filter((event) => event.type === "llm_call").every((event) => event.model === "gold")).toBe(true);
  });

  it("serves recorded LLM extractions from seed/llm-cache.json by textHash when present", async () => {
    const email = seedInbox.emails.find((candidate) => candidate.id === "nw-48213-order");
    const label = GoldLabelsFileSchema.parse(goldJson).labels.find((candidate) => candidate.emailId === "nw-48213-order");
    if (!email || !label) throw new Error("seed email nw-48213-order missing");
    const redacted = redact(email);
    const recorded = { ...extractionFromGoldLabel(redacted, label), model: "recorded-llm" };
    const cachePath = tempPath("llm-cache.json");
    writeFileSync(cachePath, JSON.stringify({ [redacted.textHash]: recorded }));

    const audit: PipelineAuditEvent[] = [];
    const result = await loadSeedDemo({ cachePath, audit: (event) => audit.push(event) });
    expect(result.stats.extractionOrigins.cache).toBe(1);
    expect(result.stats.extractionOrigins.gold).toBe(result.stats.extracted - 1);
    const cacheAudit = audit.filter((event) => event.model === "recorded-llm");
    expect(cacheAudit).toHaveLength(1);
    expect(cacheAudit[0].detail).toContain("cache hit, no LLM call");
    expect(result.findings).toHaveLength(14);
  });
});
