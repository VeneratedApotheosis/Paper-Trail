import type { EmailClass, ExtractedFields, Finding, NormalizedOrder } from "@/lib/contracts";
import type { PipelineEmailOutcome, ReviewQueueItem } from "@/lib/pipeline/run";
import type { MergeReason } from "@/lib/orders/dedup/score";
import type { Draft } from "@/lib/types";

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
  /** Gmail only (#137): Promotions-category emails read by the separate promotions pass. Not part of `fetched`; they are never classified as receipts or listed as skipped. */
  promotionsFetched?: number;
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

/** `marked_not_purchase`: the user said so ("Not a purchase" / "Not a receipt"); the classifier never sees these. */
export type SkipReason = "prefilter" | "marketing" | "not_receipt" | "phishing" | "marked_not_purchase";

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

/** One result (the ledger, or one Gmail account's stored sync) as it was before the purchase was marked. */
export interface MarkedPurchaseSnapshot {
  /** Gmail account whose stored result this is; absent for the published ledger. */
  accountId?: string;
  order: NormalizedOrder;
  findings: Finding[];
  reviewQueue: ReviewQueueItem[];
}

/**
 * What "Not a purchase" took out of the ledger, kept in memory so Undo (`POST /api/orders/:id/restore`) can put it
 * back. Derived data only. Gone after a restart, an upload or delete-all (the labels outlive a restart; the
 * skipped list's "This is a receipt" is the way back then).
 */
export interface MarkedPurchase {
  orderId: string;
  /** Merchant name, for audit rows and messages. */
  merchant: string;
  markedAt: string;
  /** Emails whose "not a receipt" label is active because of this mark. */
  emailIds: string[];
  /** State before the first mark of this order (ledger first, then each Gmail account that held it). */
  snapshots: MarkedPurchaseSnapshot[];
  drafts: Draft[];
  /** Labels the mark replaced (one label per email); restored on Undo, otherwise the label is deleted. */
  previousLabels: QualityLabel[];
  /** How each email was classified and counted before, to put its saved text and the counters back. */
  previousEmails: Array<{ emailId: string; outcome: PipelineEmailOutcome; classification: StoredEmailText["classification"] }>;
}

/** Per store scope (anonymous demo or one signed-in profile); replaced wholesale by delete-all. */
export interface QualityData {
  /** Oldest first, capped. */
  history: SyncQualityReport[];
  skipped: SkippedEmail[];
  texts: Map<string, StoredEmailText>;
  /** Monotonic counter behind SyncQualityReport.id. */
  reportSeq: number;
  /** Purchases marked "Not a purchase" and not yet restored, by order id (#134). */
  marked: Map<string, MarkedPurchase>;
}

export function emptyQualityData(): QualityData {
  return { history: [], skipped: [], texts: new Map(), reportSeq: 0, marked: new Map() };
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
