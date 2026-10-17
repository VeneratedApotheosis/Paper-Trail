import type {
  Classification,
  Extraction,
  Finding,
  NormalizedOrder,
  RedactionKind,
} from "@/lib/contracts";
import { parseEml, seedPriceFeed } from "@/lib/demo";
import {
  SKIPPED_EXTRACTION_CLASSES,
  classify,
  isReceiptLike,
  redact,
  type ExtractionCache,
  type PrefilterDecision,
} from "@/lib/ingestion";
import type { LlmClient } from "@/lib/llm";
import { matchOrders } from "@/lib/orders/matcher";
import { createLlmExtractor } from "@/lib/pipeline/extractors";
import type { PipelineAuditEvent } from "@/lib/pipeline/run";
import { defaultRules, runRules } from "@/lib/rules";

/**
 * Stage-by-stage run of ONE email for the dev playground's Email lab (issue #34). Mirrors the upload path of
 * runPipeline (prefilter -> classify raw -> redact -> extract redacted -> matchOrders -> runRules) but returns every
 * intermediate result. Nothing is stored except audit rows for LLM calls (AGENTS.md hard rule #6).
 */

export type DebugExtractionStage =
  | { status: "skipped"; reason: string }
  | { status: "ok"; extraction: Extraction }
  | { status: "needs_review"; reason: string }
  | { status: "error"; reason: string };

export interface DebugPipelineResult {
  now: string;
  email: { id: string; from: string; to: string | null; subject: string; date: string; text: string };
  prefilter: PrefilterDecision;
  classification: Classification;
  redaction: {
    subject: string;
    text: string;
    redactions: Partial<Record<RedactionKind, number>>;
    textHash: string;
  };
  extraction: DebugExtractionStage;
  /** Audit rows written for this run (LLM calls and cache hits only). */
  audit: PipelineAuditEvent[];
  /** Orders and findings for this single email; empty unless extraction succeeded. */
  orders: NormalizedOrder[];
  findings: Finding[];
}

export interface DebugPipelineOptions {
  /** RFC 822 source of one email. */
  raw: string;
  /** Rule clock. */
  now: Date;
  /** User opted in to a live LLM call. */
  useLlm: boolean;
  /** ANTHROPIC_API_KEY is set; without it extraction is always skipped. */
  llmConfigured: boolean;
  cache: ExtractionCache;
  /** Defaults to extract()'s AnthropicLlmClient. Injected in tests. */
  llm?: LlmClient;
  audit?: (event: PipelineAuditEvent) => void;
}

/** Max raw RFC 822 email size (characters) accepted by POST /api/debug/pipeline. */
export const MAX_RAW_EMAIL_CHARS = 200_000;

export const EXTRACTION_OPT_IN_REASON = "live extraction is opt-in: tick 'Use Claude (costs tokens)' to run it";
export const EXTRACTION_NO_KEY_REASON = "ANTHROPIC_API_KEY is not configured, so live extraction is unavailable";

function errorReason(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
}

/** Throws EmailParseError (from parseEml) when the email has no From or Date header. */
export async function runDebugPipeline(options: DebugPipelineOptions): Promise<DebugPipelineResult> {
  const email = parseEml(options.raw);
  const prefilter = isReceiptLike(email);
  const classification = classify(email);
  const redacted = redact(email);
  const auditRows: PipelineAuditEvent[] = [];
  const audit = (event: PipelineAuditEvent) => {
    auditRows.push(event);
    options.audit?.(event);
  };

  let extraction: DebugExtractionStage;
  if (!prefilter.keep) {
    extraction = { status: "skipped", reason: `prefilter dropped this email (${prefilter.reason}); uploads skip it too` };
  } else if (SKIPPED_EXTRACTION_CLASSES.has(classification.class)) {
    extraction = { status: "skipped", reason: `class ${classification.class} is never extracted` };
  } else if (!options.useLlm) {
    extraction = { status: "skipped", reason: EXTRACTION_OPT_IN_REASON };
  } else if (!options.llmConfigured) {
    extraction = { status: "skipped", reason: EXTRACTION_NO_KEY_REASON };
  } else {
    const extractor = createLlmExtractor({ cache: options.cache, llm: options.llm, audit });
    try {
      const result = await extractor(redacted, classification, email);
      if (result.ok) extraction = { status: "ok", extraction: result.extraction };
      else if ("skipped" in result) extraction = { status: "skipped", reason: result.reason };
      else extraction = { status: "needs_review", reason: result.reason };
    } catch (error) {
      extraction = { status: "error", reason: errorReason(error) };
    }
  }

  let orders: NormalizedOrder[] = [];
  let findings: Finding[] = [];
  if (extraction.status === "ok") {
    // Same as runPipeline: the matcher only sees the redacted email.
    orders = matchOrders([{ email: redacted, extraction: extraction.extraction }]);
    findings = runRules(orders, defaultRules, { now: options.now, priceFeed: seedPriceFeed });
  }

  return {
    now: options.now.toISOString(),
    email: {
      id: email.id,
      from: email.from,
      to: email.to ?? null,
      subject: email.subject,
      date: email.date,
      text: email.text,
    },
    prefilter,
    classification,
    redaction: {
      subject: redacted.subject,
      text: redacted.text,
      redactions: redacted.redactions,
      textHash: redacted.textHash,
    },
    extraction,
    audit: auditRows,
    orders,
    findings,
  };
}
