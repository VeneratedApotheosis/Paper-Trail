/** Ingestion stages before extraction (issue #6): prefilter -> redact -> classify. Pure, no network, no LLM. */
export {
  GMAIL_RECEIPT_QUERY,
  PREFILTER_WINDOW_DAYS,
  RECEIPT_SENDER_TERMS,
  RECEIPT_SUBJECT_TERMS,
  describePrefilterQuery,
  isReceiptLike,
} from "./prefilter";
export type { PrefilterDecision } from "./prefilter";
export { hashRedactedText, passesLuhn, redact } from "./redact";
export { classify } from "./classify";
/** Extraction (issue #7): LLM structured extraction, validated with ExtractionSchema, cached by textHash. */
export { createFileCache, createMemoryCache } from "./cache";
export type { ExtractionCache } from "./cache";
export { SKIPPED_EXTRACTION_CLASSES, computeConfMin, extract } from "./extract";
export type { ExtractDeps, ExtractResult, ExtractionAuditEntry } from "./extract";
export { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_TOOL, EXTRACTION_TOOL_NAME, buildExtractionPrompt } from "./extract-prompt";
