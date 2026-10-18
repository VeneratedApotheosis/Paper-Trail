import type { RedactedEmail } from "@/lib/contracts";
import { extract, type ExtractionAuditEntry, type ExtractionCache } from "@/lib/ingestion";
import type { LlmClient } from "@/lib/llm";
import type { PipelineAuditEvent, PipelineExtractor } from "./run";

/** Number of PII tokens redaction replaced in the email (reported as AuditEntry.redactedTokenCount). */
export function redactedTokenCount(email: RedactedEmail): number {
  return Object.values(email.redactions).reduce((sum, count) => sum + (count ?? 0), 0);
}

/** Converts extract()'s audit row into a store audit event: ids, model and token counts only. */
export function llmCallAuditEvent(entry: ExtractionAuditEntry, email: RedactedEmail): PipelineAuditEvent {
  const usage = entry.outcome === "error" ? `failed: ${entry.errorClass}` : entry.cached
    ? "cache hit, no LLM call"
    : `${entry.inputTokens} input / ${entry.outputTokens} output tokens`;
  return {
    at: entry.at,
    type: "llm_call",
    model: entry.model,
    redactedTokenCount: redactedTokenCount(email),
    detail: `Extract fields — email ${entry.emailId} (${usage})`,
  };
}

export interface LlmExtractorOptions {
  cache?: ExtractionCache;
  /** Defaults to extract()'s AnthropicLlmClient, which throws LlmUnavailableError without ANTHROPIC_API_KEY. */
  llm?: LlmClient;
  audit?: (event: PipelineAuditEvent) => void;
  /** Sees every extract() audit row (token counts, cache hits, failures) for quality reports (#117). */
  onUsage?: (entry: ExtractionAuditEntry) => void;
  now?: () => Date;
}

/** Extractor backed by extract(): cache by textHash first, then the LLM (validated, retried once). */
export function createLlmExtractor(options: LlmExtractorOptions = {}): PipelineExtractor {
  return (redacted, classification) =>
    extract(redacted, classification, {
      cache: options.cache,
      llm: options.llm,
      now: options.now,
      audit: (entry) => {
        options.onUsage?.(entry);
        options.audit?.(llmCallAuditEvent(entry, redacted));
      },
    });
}
