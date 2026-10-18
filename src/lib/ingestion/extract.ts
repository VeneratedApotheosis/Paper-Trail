import type { ZodError } from "zod";
import {
  EvidenceSchema,
  ExtractedFieldNameSchema,
  MAX_TRACKING_NUMBERS,
  MAX_TRAVEL_SEGMENTS,
  OTHER_REFS_MAX,
  OTHER_REF_MAX_CHARS,
  ExtractionSchema,
  PurchaseKindSchema,
  ShipmentStatusSchema,
  SubscriptionIntervalSchema,
  type Classification,
  type EmailClass,
  type ExtractedFieldName,
  type Extraction,
  type RedactedEmail,
} from "@/lib/contracts";
import { AnthropicLlmClient, LlmUnavailableError, type LlmClient } from "@/lib/llm";
import { llmErrorClass } from "@/lib/llm/audit";
import type { ExtractionCache } from "./cache";
import {
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_TOOL,
  EXTRACTION_TOOL_NAME,
  buildExtractionPrompt,
  buildRetryPrompt,
} from "./extract-prompt";

/**
 * LLM structured extraction (issue #7): redacted email -> Extraction validated by ExtractionSchema.
 * Invalid output is retried once with the validation error, then routed to needs-review (never dropped).
 * Provider failures (missing key, HTTP 429/5xx, timeout) are thrown as LlmError for the caller to retry or report.
 */

/** Phishing look-alikes and promos never become orders, so they never reach the LLM. */
export const SKIPPED_EXTRACTION_CLASSES: ReadonlySet<EmailClass> = new Set<EmailClass>(["marketing", "not_receipt"]);

const MAX_ATTEMPTS = 2;
const EVIDENCE_MAX_CHARS = EvidenceSchema.maxLength ?? 200;
const MAX_VALIDATION_ERROR_CHARS = 1000;

/**
 * One audit row per provider call that was actually attempted. Cache reads and gold labels are not calls, and neither is
 * LlmUnavailableError (no API key: nothing was sent). Carries token counts only, never email text.
 */
export type ExtractionAuditEntry = {
  at: string;
  actor: "llm";
  action: "llm_call";
  model: string;
  inputTokens: number;
  outputTokens: number;
  emailId: string;
  outcome?: "success" | "error";
  errorClass?: string;
};

export type ExtractDeps = {
  /** Defaults to AnthropicLlmClient (reads ANTHROPIC_API_KEY); only constructed on a cache miss. */
  llm?: LlmClient;
  cache?: ExtractionCache;
  audit?: (entry: ExtractionAuditEntry) => void;
  now?: () => Date;
};

export type ExtractResult =
  | { ok: true; extraction: Extraction }
  | { ok: false; needsReview: true; reason: string; raw?: unknown }
  | { ok: false; skipped: true; reason: string };

type Validation = { ok: true; extraction: Extraction } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: unknown): unknown {
  return typeof value === "string" ? value.slice(0, EVIDENCE_MAX_CHARS) : value;
}

function truncateEvidence(evidence: unknown): unknown {
  if (!isRecord(evidence)) return evidence;
  return Object.fromEntries(Object.entries(evidence).map(([field, quote]) => [field, truncate(quote)]));
}

/** Keeps `otherRefs` usable: trims, drops non-strings and empties, de-duplicates, clips long entries and caps the list. */
function cleanOtherRefs(fields: unknown): unknown {
  if (!isRecord(fields) || !Array.isArray(fields.otherRefs)) return fields;
  const cleaned = fields.otherRefs
    .filter((ref): ref is string => typeof ref === "string")
    .map((ref) => ref.trim().slice(0, OTHER_REF_MAX_CHARS))
    .filter((ref) => ref !== "");
  return { ...fields, otherRefs: [...new Set(cleaned)].slice(0, OTHER_REFS_MAX) };
}

/** The value when it is one of the enum's options, else null. */
function enumOrNull(options: readonly string[], value: unknown): string | null {
  return typeof value === "string" && options.includes(value) ? value : null;
}

function cleanStrings(value: unknown, maxChars: number, maxCount: number): string[] {
  if (!Array.isArray(value)) return [];
  const cleaned = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().slice(0, maxChars))
    .filter((entry) => entry !== "");
  return [...new Set(cleaned)].slice(0, maxCount);
}

/**
 * Kind and kind details (#127) are unscored hints, so a malformed piece is repaired or dropped instead of failing the
 * whole extraction: unknown enum values become null, tracking numbers are trimmed and capped, bad travel segments go.
 */
function cleanKindDetails(fields: unknown): unknown {
  if (!isRecord(fields)) return fields;
  const next: Record<string, unknown> = { ...fields };
  if ("kindGuess" in next) next.kindGuess = enumOrNull(PurchaseKindSchema.options, next.kindGuess);
  if (isRecord(next.shipment)) {
    next.shipment = {
      ...next.shipment,
      trackingNumbers: cleanStrings(next.shipment.trackingNumbers, 64, MAX_TRACKING_NUMBERS),
      status: enumOrNull(ShipmentStatusSchema.options, next.shipment.status),
    };
  }
  if (isRecord(next.subscription)) {
    next.subscription = { ...next.subscription, interval: enumOrNull(SubscriptionIntervalSchema.options, next.subscription.interval) };
  }
  if (isRecord(next.travel)) {
    const segments = Array.isArray(next.travel.segments) ? next.travel.segments : [];
    next.travel = {
      ...next.travel,
      segments: segments
        .filter((segment): segment is Record<string, unknown> => isRecord(segment) && typeof segment.label === "string" && segment.label.trim() !== "")
        .map((segment) => ({
          label: String(segment.label).trim(),
          start: typeof segment.start === "string" ? segment.start : null,
          end: typeof segment.end === "string" ? segment.end : null,
        }))
        .slice(0, MAX_TRAVEL_SEGMENTS),
    };
  }
  return next;
}

function truncatePolicyQuote(fields: unknown): unknown {
  if (!isRecord(fields) || !("policyQuote" in fields)) return fields;
  return { ...fields, policyQuote: truncate(fields.policyQuote) };
}

/** False, empty lists, and all-null totals count as "not extracted". */
function isPresent(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.values(value).some((entry) => entry !== null && entry !== undefined);
  return true;
}

/**
 * Lowest confidence over extracted (present) fields. A present field without a confidence counts as 0,
 * and an extraction with no present fields scores 0, so both land in needs-review.
 */
export function computeConfMin(
  fields: Extraction["fields"],
  confidence: Partial<Record<ExtractedFieldName, number>>,
): number {
  const present = ExtractedFieldNameSchema.options.filter((name) => isPresent(fields[name]));
  if (present.length === 0) return 0;
  return Math.min(...present.map((name) => confidence[name] ?? 0));
}

function formatZodError(error: ZodError): string {
  const lines = error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  return lines.join("\n").slice(0, MAX_VALIDATION_ERROR_CHARS);
}

function validateToolInput(
  toolInput: unknown,
  email: RedactedEmail,
  classification: Classification,
  model: string,
): Validation {
  if (!isRecord(toolInput)) {
    return { ok: false, error: `(root): expected a ${EXTRACTION_TOOL_NAME} tool call with an object input` };
  }
  const parsed = ExtractionSchema.safeParse({
    emailId: email.id,
    class: classification.class,
    fields: cleanKindDetails(cleanOtherRefs(truncatePolicyQuote(toolInput.fields))),
    confidence: toolInput.confidence,
    evidence: truncateEvidence(toolInput.evidence),
    confMin: 0,
    model,
    cached: false,
  });
  if (!parsed.success) return { ok: false, error: formatZodError(parsed.error) };
  const extraction = parsed.data;
  extraction.fields.customerName = null;
  delete extraction.evidence.customerName;
  delete extraction.confidence.customerName;
  return { ok: true, extraction: { ...extraction, confMin: computeConfMin(extraction.fields, extraction.confidence) } };
}

export async function extract(
  email: RedactedEmail,
  classification: Classification,
  deps: ExtractDeps = {},
): Promise<ExtractResult> {
  if (SKIPPED_EXTRACTION_CLASSES.has(classification.class)) {
    return { ok: false, skipped: true, reason: `class ${classification.class} is never extracted` };
  }

  const now = deps.now ?? (() => new Date());
  const audit = deps.audit ?? (() => undefined);
  const logCall = (model: string, inputTokens: number, outputTokens: number) =>
    audit({ at: now().toISOString(), actor: "llm", action: "llm_call", model, inputTokens, outputTokens, emailId: email.id, outcome: "success" });

  const hit = deps.cache?.get(email.textHash);
  if (hit) {
    // A cache read is not a provider call; provenance is counted by the pipeline.
    return { ok: true, extraction: { ...hit, emailId: email.id, class: classification.class, cached: true } };
  }

  const llm = deps.llm ?? new AnthropicLlmClient();
  let user = buildExtractionPrompt(email);
  let lastError = "";
  let raw: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await llm.callTool({
      system: EXTRACTION_SYSTEM_PROMPT,
      user,
      tool: EXTRACTION_TOOL,
      textHash: email.textHash,
    }).catch(error => {
      if (!(error instanceof LlmUnavailableError)) {
        audit({ at: now().toISOString(), actor: "llm", action: "llm_call", model: llm.model,
          inputTokens: 0, outputTokens: 0, emailId: email.id,
          outcome: "error", errorClass: llmErrorClass(error) });
      }
      throw error;
    });
    logCall(response.model, response.usage.inputTokens, response.usage.outputTokens);
    raw = response.toolInput;

    const validation = validateToolInput(response.toolInput, email, classification, response.model);
    if (validation.ok) {
      deps.cache?.set(email.textHash, validation.extraction);
      return { ok: true, extraction: validation.extraction };
    }
    lastError = validation.error;
    user = buildRetryPrompt(email, lastError);
  }

  return { ok: false, needsReview: true, reason: `LLM output failed validation after retry: ${lastError}`, raw };
}
