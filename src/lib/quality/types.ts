import type { EmailClass, ExtractedFields } from "@/lib/contracts";
import type { PipelineEmailOutcome } from "@/lib/pipeline/run";
import type { MergeReason } from "@/lib/orders/dedup/score";

/**
 * Quality tracking (#117). Everything here is derived data: counts, safe metadata (sender name + domain, subject) and
 * REDACTED email text. Raw bodies and raw addresses are never kept.
 */

export type QualitySource = "gmail" | "upload" | "demo";

/** One finished pipeline run (Gmail: one account's sync). */
export interface SyncQualityReport {
  /** Unique within the history, e.g. `q3`. */
  id: string;
  /** ISO time the run was recorded. */
  at: string;
  source: QualitySource;
  /** Linked Gmail account id (`GET /api/account` `accounts[].id`); only for Gmail runs. */
  accountId?: string;
  /** Messages the source handed over (Gmail: listed, including ones that could not be decoded). */
  fetched: number;
  /** Dropped by the receipt prefilter before classification. */
  prefilteredOut: number;
  /** Classifier verdicts of the emails that were classified. */
  classified: Partial<Record<EmailClass, number>>;
  /** Classified marketing / not_receipt (incl. phishing look-alikes), so never extracted. */
  skippedNonReceipt: number;
  extracted: number;
  /** Extractions whose lowest field confidence is under 0.7 (excluded from owed totals until confirmed). */
  lowConfidence: number;
  /** Extraction attempts that failed or never validated (they sit in the review queue). */
  extractionFailures: number;
  matchedOrders: number;
  /** Emails collapsed into an identical earlier email before extraction (#126); no LLM call was spent on them. */
  duplicatesCollapsed?: number;
  /** Purchases joined by dedup (#126), by the evidence: message_id, fingerprint, shared_ref, thread, items_amount. */
  mergesByReason?: Partial<Record<MergeReason, number>>;
  /** Orders flagged as a possible duplicate of another (not merged). */
  possibleDuplicates?: number;
  findings: number;
  /** LLM requests that left the machine (cache hits are not counted). */
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  /** Gmail only: decoded messages by the MIME part their text came from. Zero for demo and mbox uploads. */
  bodySource: { plain: number; html: number };
}

export type SkipReason = "prefilter" | "marketing" | "not_receipt" | "phishing";

/** Safe metadata about an email that produced no order. No body, no addresses beyond the sender domain. */
export interface SkippedEmail {
  emailId: string;
  accountId?: string;
  from: { name: string | null; domain: string | null };
  /** Redacted subject. */
  subject: string;
  date: string;
  reason: SkipReason;
  /** Classifier confidence; null when the prefilter dropped the email before classification. */
  classConfidence: number | null;
}

/** Redacted copy of one email kept in memory (never on disk) so feedback and labels need no re-fetch. */
export interface StoredEmailText {
  emailId: string;
  accountId?: string;
  fromName: string | null;
  fromDomain: string | null;
  subject: string;
  date: string;
  text: string;
  textHash: string;
  redactions: Record<string, number>;
  classification: { class: EmailClass; confidence: number; reason?: string } | null;
  outcome: PipelineEmailOutcome;
}

/** Per store scope (anonymous demo or one signed-in profile); replaced wholesale by delete-all. */
export interface QualityData {
  /** Oldest first, capped. */
  history: SyncQualityReport[];
  skipped: SkippedEmail[];
  texts: Map<string, StoredEmailText>;
  /** Monotonic counter behind SyncQualityReport.id. */
  reportSeq: number;
}

export function emptyQualityData(): QualityData {
  return { history: [], skipped: [], texts: new Map(), reportSeq: 0 };
}

export type LabelSource = "review" | "feedback";

/**
 * A human-corrected example. `fields` are ground truth only where a person checked them (review edits / confirms);
 * feedback labels ("this is a receipt") carry the class only (`fields: null`).
 */
export interface QualityLabel {
  emailId: string;
  accountId?: string;
  source: LabelSource;
  class: EmailClass;
  fields: Partial<ExtractedFields> | null;
  /** Redacted body, as sent to the extractor. */
  redactedText: string;
  textHash: string;
  /** Redacted subject. */
  subject: string;
  /** Sanitized sender header (`"Name" <sender@domain>`), enough for the sender-domain prompt line. */
  from: string;
  date: string;
  at: string;
}
