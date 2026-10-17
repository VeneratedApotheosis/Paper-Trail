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
