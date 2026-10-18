import type { RawEmail } from "@/lib/contracts";
import type { ExtractionCache } from "@/lib/ingestion";
import type { LlmClient } from "@/lib/llm";
import { createLlmExtractor, type LlmExtractorOptions } from "@/lib/pipeline/extractors";
import { runPipeline, type PipelineAuditEvent, type PipelineDeps, type PipelineResult } from "@/lib/pipeline/run";
import { loadSeedLlmCache } from "./seed";

/** Max total upload size accepted by POST /api/upload. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Most emails one upload may contain (#91), the same order of magnitude as a Gmail sync. */
export const MAX_UPLOAD_EMAILS = 300;

/** Reads from `primary` then `fallback`; writes go to `primary` only (the committed seed cache is never modified). */
function layeredCache(primary: ExtractionCache, fallback: ExtractionCache | null): ExtractionCache {
  return {
    get: (textHash) => primary.get(textHash) ?? fallback?.get(textHash),
    set: (textHash, extraction) => primary.set(textHash, extraction),
  };
}

export interface UploadPipelineOptions {
  /** Session extraction cache (purged by delete-all). */
  cache: ExtractionCache;
  now: Date;
  audit?: (event: PipelineAuditEvent) => void;
  excludedMerchants?: ReadonlySet<string>;
  /** Defaults to the Anthropic client; without ANTHROPIC_API_KEY, cache misses go to the review queue. */
  llm?: LlmClient;
  /** Quality tracking hooks (#117). */
  observer?: PipelineDeps["observer"];
  classOverride?: PipelineDeps["classOverride"];
  onUsage?: LlmExtractorOptions["onUsage"];
}

/** Runs uploaded .eml/.mbox emails through the shared pipeline with real (cached) LLM extraction. */
export function runUploadPipeline(emails: readonly RawEmail[], options: UploadPipelineOptions): Promise<PipelineResult> {
  const extractor = createLlmExtractor({
    cache: layeredCache(options.cache, loadSeedLlmCache()),
    llm: options.llm,
    audit: options.audit,
    onUsage: options.onUsage,
  });
  return runPipeline(emails, {
    now: options.now,
    extractor,
    audit: options.audit,
    excludedMerchants: options.excludedMerchants,
    applyPrefilter: true,
    sourceLabel: "upload",
    observer: options.observer,
    classOverride: options.classOverride,
  });
}
