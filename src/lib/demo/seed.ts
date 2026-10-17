import { existsSync } from "node:fs";
import { join } from "node:path";
import { GoldLabelsFileSchema, SeedInboxSchema, type GoldLabel } from "@/lib/contracts";
import { createFileCache, extract, type ExtractionCache } from "@/lib/ingestion";
import { FixtureLlmClient } from "@/lib/llm";
import { redactedTokenCount, llmCallAuditEvent } from "@/lib/pipeline/extractors";
import { extractionFromGoldLabel } from "@/lib/pipeline/gold";
import { runPipeline, type PipelineAuditEvent, type PipelineExtractor, type PipelineResult } from "@/lib/pipeline/run";
import { PriceFeedSchema, type PriceFeed } from "@/lib/prices/feed";
import goldJson from "../../../seed/gold_labels.json";
import inboxJson from "../../../seed/inbox.json";
import priceFeedJson from "../../../seed/price-feed.json";

/**
 * Demo mode (issue #4, F1.2): runs the synthetic seed inbox through the same pipeline as Gmail, fully offline.
 *
 * Extraction source per email:
 * 1. `seed/llm-cache.json` (`{ [textHash]: Extraction }`, recorded real LLM output) via extract()'s cache path.
 * 2. Otherwise the seed gold label via extractionFromGoldLabel(): model "gold", audited as
 *    "precomputed, no LLM call", so gold labels are never presented as LLM output.
 */

export const SEED_LLM_CACHE_PATH = join(process.cwd(), "seed", "llm-cache.json");

export const seedInbox = SeedInboxSchema.parse(inboxJson);
export const seedPriceFeed: PriceFeed = PriceFeedSchema.parse(priceFeedJson);
const goldByEmailId: ReadonlyMap<string, GoldLabel> = new Map(
  GoldLabelsFileSchema.parse(goldJson).labels.map((label) => [label.emailId, label]),
);

/** Read-only view of the committed seed cache: demo mode never writes it. Null when the file is absent. */
export function loadSeedLlmCache(path: string = SEED_LLM_CACHE_PATH): ExtractionCache | null {
  if (!existsSync(path)) return null;
  const file = createFileCache(path);
  return { get: (textHash) => file.get(textHash), set: () => undefined };
}

export interface SeedExtractorOptions {
  seedCache: ExtractionCache | null;
  audit?: (event: PipelineAuditEvent) => void;
  now?: () => Date;
}

/** Offline extractor for seed emails: seed LLM cache hit, else precomputed gold label. Never calls a provider. */
export function createSeedExtractor(options: SeedExtractorOptions): PipelineExtractor {
  const now = options.now ?? (() => new Date());
  // No canned answers: if extract() ever missed the cache it would throw instead of reaching the network.
  const offlineLlm = new FixtureLlmClient({});
  return async (redacted, classification, raw) => {
    const seedCache = options.seedCache;
    if (seedCache?.get(redacted.textHash)) {
      return extract(redacted, classification, {
        cache: seedCache,
        llm: offlineLlm,
        now,
        audit: (entry) => options.audit?.(llmCallAuditEvent(entry, redacted)),
      });
    }
    const label = goldByEmailId.get(raw.id);
    if (!label) {
      return { ok: false, needsReview: true, reason: "no cached LLM extraction or gold label for this seed email" };
    }
    // Built from the redacted email so evidence quotes never carry unredacted PII.
    const extraction = extractionFromGoldLabel(redacted, label);
    options.audit?.({
      at: now().toISOString(),
      type: "llm_call",
      model: extraction.model,
      redactedTokenCount: redactedTokenCount(redacted),
      detail: `Precomputed extraction from seed gold label, no LLM call — email ${raw.id}`,
    });
    return { ok: true, extraction };
  };
}

export interface SeedDemoOptions {
  audit?: (event: PipelineAuditEvent) => void;
  excludedMerchants?: ReadonlySet<string>;
  /** Defaults to SEED_LLM_CACHE_PATH. */
  cachePath?: string;
  auditClock?: () => Date;
}

export interface SeedDemoResult extends PipelineResult {
  asOf: string;
  simulatedPriceFeed: boolean;
}

export async function loadSeedDemo(options: SeedDemoOptions = {}): Promise<SeedDemoResult> {
  const extractor = createSeedExtractor({
    seedCache: loadSeedLlmCache(options.cachePath),
    audit: options.audit,
    now: options.auditClock,
  });
  const result = await runPipeline(seedInbox.emails, {
    now: new Date(seedInbox.asOf),
    priceFeed: seedPriceFeed,
    extractor,
    audit: options.audit,
    excludedMerchants: options.excludedMerchants,
    applyPrefilter: true,
    sourceLabel: "demo, synthetic seed inbox",
    auditClock: options.auditClock,
  });
  return { ...result, asOf: seedInbox.asOf, simulatedPriceFeed: seedPriceFeed.simulated };
}
