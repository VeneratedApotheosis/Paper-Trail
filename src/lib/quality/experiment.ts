import type { Classification, ExtractedFieldName, RedactedEmail } from "@/lib/contracts";
import { extract, prepareForLlm, type RedactionMode, type ExtractResult, type ExtractionAuditEntry, type ExtractionCache } from "@/lib/ingestion";
import { AnthropicLlmClient, DEFAULT_LLM_MODEL, LlmUnavailableError, type LlmClient } from "@/lib/llm";
import { runRealEval } from "@/lib/eval/real";
import type { FieldScore } from "@/lib/eval/metrics";
import type { PipelineAuditEvent } from "@/lib/pipeline/run";
import { llmCallAuditEvent } from "@/lib/pipeline/extractors";
import { QualityError } from "./feedback";
import { EXPERIMENT_WARNING, MAX_EXPERIMENT_LABELS, PROMPT_VARIANTS, PROMPT_VARIANT_IDS, type PromptVariantId } from "./experiment-variants";
import { redactedEmailOfLabel } from "./text";
import { estimateCostUsd } from "./pricing";
import type { QualityLabel } from "./types";

/**
 * Experiments (#117): run the labeled set through another model and/or prompt variant and compare accuracy and cost
 * with the current setting. The live setting (LLM_MODEL), the live extraction cache and the ledger are never touched.
 * This DOES call Claude: once per label per side, so it is bounded to MAX_EXPERIMENT_LABELS and only runs on request.
 */

export interface ExperimentRequest {
  /** Model to try; default: the current model (useful with `promptVariant`). */
  model?: string;
  promptVariant?: PromptVariantId;
}

export interface ExperimentSide {
  model: string;
  promptVariant: PromptVariantId;
  labelsScored: number;
  unscored: number;
  overallAccuracy: number;
  perField: Partial<Record<ExtractedFieldName, FieldScore>>;
  /** Labels answered from the live extraction cache (current setting only): no tokens spent. */
  cachedLabels: number;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  /** Estimate for the calls made (see pricing.ts); null for a model without a known price. */
  estimatedCostUsd: number | null;
}

export interface ExperimentResult {
  warning: string;
  labelsAvailable: number;
  labelsUsed: number;
  capped: boolean;
  current: ExperimentSide;
  /** Null when the request equals the current setting. */
  candidate: ExperimentSide | null;
}

export interface ExperimentDeps {
  /** The live model name (LLM_MODEL or the default); only compared against and shown, never changed. */
  currentModel?: string;
  /** Builds a client for a model. Defaults to the Anthropic client. */
  llmFor?: (model: string) => LlmClient;
  /** The live cache: read for the current setting, never written. */
  cache?: ExtractionCache;
  audit?: (event: PipelineAuditEvent) => void;
  now?: () => Date;
  /** Pins the redaction switch (#125); default: PAPERTRAIL_REDACT. */
  redaction?: RedactionMode;
}

const EXPERIMENT_CONCURRENCY = 4;

export { MAX_EXPERIMENT_LABELS, PROMPT_VARIANTS, PROMPT_VARIANT_IDS, EXPERIMENT_WARNING };
export type { PromptVariantId };

export function currentModelName(): string {
  return process.env.LLM_MODEL ?? DEFAULT_LLM_MODEL;
}

function withPromptVariant(llm: LlmClient, addendum: string): LlmClient {
  if (!addendum) return llm;
  return { get model() { return llm.model; }, callTool: (request) => llm.callTool({ ...request, system: `${request.system}\n\n${addendum}` }) };
}

async function mapPool<T, R>(items: readonly T[], size: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    for (let index = next++; index < items.length; index = next++) results[index] = await task(items[index]);
  }));
  return results;
}

async function runSide(
  labels: readonly QualityLabel[], model: string, variant: PromptVariantId, deps: ExperimentDeps, readCache: ExtractionCache | undefined,
): Promise<ExperimentSide> {
  const llm = withPromptVariant((deps.llmFor ?? ((name) => new AnthropicLlmClient({ model: name })))(model), PROMPT_VARIANTS[variant].addendum);
  const usage = { llmCalls: 0, inputTokens: 0, outputTokens: 0, cached: 0 };
  let unavailable = false;
  const record = (entry: ExtractionAuditEntry, email: RedactedEmail) => {
    usage.llmCalls += 1;
    usage.inputTokens += entry.inputTokens;
    usage.outputTokens += entry.outputTokens;
    deps.audit?.(llmCallAuditEvent(entry, email));
  };
  // Nothing is ever written back: the cache argument is a read-only view of the live cache (or absent).
  const cache: ExtractionCache | undefined = readCache && { get: (hash) => readCache.get(hash), set: () => undefined };
  const results = await mapPool(labels, EXPERIMENT_CONCURRENCY, async (label): Promise<ExtractResult | null> => {
    // Saved label text may have been stored under another mode: re-prepare it for the current one before it reaches Claude.
    const email = prepareForLlm(redactedEmailOfLabel(label), deps.redaction);
    const classification: Classification = { emailId: label.emailId, class: label.class, confidence: 1 };
    try {
      const result = await extract(email, classification, { llm, cache, now: deps.now, audit: (entry) => record(entry, email) });
      // Cache reads are not audited (#40), so count them from the result.
      if (result.ok && result.extraction.cached) usage.cached += 1;
      return result;
    } catch (error) {
      if (error instanceof LlmUnavailableError) unavailable = true;
      return null;
    }
  });
  if (unavailable) {
    throw new QualityError(503, "Claude is not configured (ANTHROPIC_API_KEY is not set), so the experiment could not run.");
  }
  const byEmail = new Map(labels.map((label, index) => [label.emailId, results[index]]));
  const report = await runRealEval(labels, {
    extractor: async (email) => byEmail.get(email.id) ?? { ok: false, needsReview: true, reason: "extraction failed" },
  });
  if (report.extraction.status !== "ok") throw new Error("experiment extraction was not scored");
  return {
    model, promptVariant: variant,
    labelsScored: report.extraction.labelsScored,
    unscored: report.extraction.unscored.length,
    overallAccuracy: report.extraction.overallAccuracy,
    perField: report.extraction.perField,
    cachedLabels: usage.cached,
    llmCalls: usage.llmCalls,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    estimatedCostUsd: estimateCostUsd(model, usage.inputTokens, usage.outputTokens),
  };
}

/** Labels an experiment can score: corrected fields on a receipt class, newest first, at most MAX_EXPERIMENT_LABELS. */
export function experimentLabels(labels: readonly QualityLabel[]): { available: number; used: QualityLabel[] } {
  const usable = labels.filter((label) => label.fields !== null && label.class !== "marketing" && label.class !== "not_receipt");
  return { available: usable.length, used: usable.slice(0, MAX_EXPERIMENT_LABELS) };
}

/** Compares the current setting with `request` on the labeled set. Throws QualityError(400) when there is nothing to score. */
export async function runExperiment(labels: readonly QualityLabel[], request: ExperimentRequest, deps: ExperimentDeps = {}): Promise<ExperimentResult> {
  const { available, used } = experimentLabels(labels);
  if (used.length === 0) {
    throw new QualityError(400, "No labels with corrected fields yet. Edit or confirm orders in Review first; those become the answer key.");
  }
  const currentModel = deps.currentModel ?? currentModelName();
  const model = request.model ?? currentModel;
  const variant = request.promptVariant ?? "default";
  const current = await runSide(used, currentModel, "default", deps, deps.cache);
  const sameAsCurrent = model === currentModel && variant === "default";
  const candidate = sameAsCurrent ? null : await runSide(used, model, variant, deps, undefined);
  return { warning: EXPERIMENT_WARNING, labelsAvailable: available, labelsUsed: used.length, capped: available > used.length, current, candidate };
}
