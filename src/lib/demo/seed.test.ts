import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoldLabelsFileSchema } from "@/lib/contracts";
import { computeOwed } from "@/lib/rules/owed";
import { prepareForLlm } from "@/lib/ingestion";
import { extractionFromGoldLabel } from "@/lib/pipeline/gold";
import type { PipelineAuditEvent } from "@/lib/pipeline/run";
import goldJson from "../../../seed/gold_labels.json";
import { loadSeedDemo, seedInbox } from "./seed";

const tempDirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pt-seed-"));
  tempDirs.push(dir);
  return join(dir, name);
}

describe.each(["on", "off"] as const)("loadSeedDemo with PAPERTRAIL_REDACT=%s", (mode) => {
  it("reproduces the 14 seed findings and $1,774.23 owed, with every email still extracted", async () => {
    vi.stubEnv("PAPERTRAIL_REDACT", mode);
    const result = await loadSeedDemo({ cachePath: tempPath("missing.json") });
    expect(result.findings).toHaveLength(14);
    expect(computeOwed(result.findings, result.orders).owedTotal).toBe(1774.23);
    expect(result.reviewQueue).toEqual([]);
  });
});

describe("loadSeedDemo", () => {
  it("falls back to precomputed gold extractions when no seed LLM cache exists", async () => {
    const audit: PipelineAuditEvent[] = [];
    const result = await loadSeedDemo({ cachePath: tempPath("missing.json"), audit: (event) => audit.push(event) });
    expect(result.asOf).toBe(seedInbox.asOf);
    expect(result.simulatedPriceFeed).toBe(true);
    expect(result.findings).toHaveLength(14);
    expect(computeOwed(result.findings, result.orders).owedTotal).toBe(1774.23);
    expect(result.stats.extractionOrigins.cache).toBe(0);
    expect(result.stats.extractionOrigins.gold).toBe(result.stats.extracted);
    expect(result.reviewQueue).toEqual([]);
    expect(audit.filter((event) => event.type === "llm_call")).toEqual([]);
  });

  it("serves recorded LLM extractions from seed/llm-cache.json by textHash when present", async () => {
    const email = seedInbox.emails.find((candidate) => candidate.id === "nw-48213-order");
    const label = GoldLabelsFileSchema.parse(goldJson).labels.find((candidate) => candidate.emailId === "nw-48213-order");
    if (!email || !label) throw new Error("seed email nw-48213-order missing");
    const redacted = prepareForLlm(email);
    const recorded = { ...extractionFromGoldLabel(redacted, label), model: "recorded-llm" };
    const cachePath = tempPath("llm-cache.json");
    writeFileSync(cachePath, JSON.stringify({ [redacted.textHash]: recorded }));

    const audit: PipelineAuditEvent[] = [];
    const result = await loadSeedDemo({ cachePath, audit: (event) => audit.push(event) });
    expect(result.stats.extractionOrigins.cache).toBe(1);
    expect(result.stats.extractionOrigins.gold).toBe(result.stats.extracted - 1);
    const cacheAudit = audit.filter((event) => event.model === "recorded-llm");
    expect(cacheAudit).toHaveLength(0);
    expect(audit.filter(event => event.type === "llm_call")).toEqual([]);
    expect(result.findings).toHaveLength(14);
  });
});
