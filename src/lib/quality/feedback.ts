import { REVIEW_CONFIDENCE_THRESHOLD, type EmailClass, type ExtractedFields, type NormalizedOrder } from "@/lib/contracts";
import { SKIPPED_EXTRACTION_CLASSES, extract, prepareForLlm, type RedactionMode } from "@/lib/ingestion";
import { LlmError, LlmUnavailableError, type LlmClient } from "@/lib/llm";
import { seedPriceFeed } from "@/lib/demo/seed";
import { llmCallAuditEvent } from "@/lib/pipeline/extractors";
import type { ReviewEdit } from "@/lib/review/schema";
import {
  appendAudit, beginStoreWork, currentStoreScope, getExcludedMerchants, getExtractionCache, getQualityData, getState,
  updateLedgerResult,
} from "@/lib/store";
import { addExtractionToResult, removeEmailFromResult } from "./contribution";
import { labelStore, type LabelStore } from "./labels";
import { redactedEmailOf, sanitizedFrom } from "./text";
import type { QualityLabel, SkippedEmail, StoredEmailText } from "./types";

/** A refusal with an HTTP status for the route to return. `details` never carries email text. */
export class QualityError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
    this.name = "QualityError";
  }
}

export interface FeedbackOptions {
  /** Defaults to the Anthropic client (needs ANTHROPIC_API_KEY); tests inject a fake. */
  llm?: LlmClient;
  now?: Date;
  /** Defaults to the local SQLite label store. */
  labels?: LabelStore;
  /** Pins the redaction switch (#125); default: PAPERTRAIL_REDACT. */
  redaction?: RedactionMode;
}

export interface ReceiptFeedbackOptions extends FeedbackOptions {
  /** Receipt class to extract as; default: the classifier's class if it was a receipt class, else "order". */
  class?: EmailClass;
}

export interface ReceiptFeedbackResult {
  emailId: string;
  class: EmailClass;
  /** An extraction was produced and merged into the ledger. */
  extracted: boolean;
  /** The extraction failed validation or is low confidence: it waits in the review queue. */
  needsReview: boolean;
  orderId: string | null;
  /** The extracted order was not added because its merchant is excluded. */
  excludedMerchant: boolean;
  labeled: true;
}

export interface NotReceiptFeedbackResult {
  emailId: string;
  removedOrders: number;
  /** The email's order also holds other emails, so it was left in place (fix it in Review). */
  keptSharedOrders: number;
  labeled: true;
}

const isReceiptClass = (value: EmailClass | undefined): value is EmailClass => value !== undefined && !SKIPPED_EXTRACTION_CLASSES.has(value);

function labelOf(stored: StoredEmailText, cls: EmailClass, source: QualityLabel["source"], fields: QualityLabel["fields"], at: Date): QualityLabel {
  return {
    emailId: stored.emailId, ...(stored.accountId ? { accountId: stored.accountId } : {}), source, class: cls, fields,
    redactedText: stored.text, textHash: stored.textHash, subject: stored.subject,
    from: sanitizedFrom({ name: stored.fromName, domain: stored.fromDomain }), date: stored.date, at: at.toISOString(),
  };
}

function ledgerClock(options: FeedbackOptions): { now: Date; priceFeed?: typeof seedPriceFeed } {
  const state = getState();
  // Demo data keeps its fixed as-of and simulated feed; live data never gets seed prices (same as Review).
  return state.mode === "demo" && state.asOf ? { now: new Date(state.asOf), priceFeed: seedPriceFeed } : { now: options.now ?? new Date() };
}

function requireLedger() {
  const state = getState();
  if (state.mode === "empty") throw new QualityError(409, "There is no ledger to update; sync, upload or load the demo first.");
  return state;
}

function requireText(emailId: string): StoredEmailText {
  const stored = getQualityData().texts.get(emailId);
  if (!stored) {
    throw new QualityError(404, "No saved text for this email (it is not from the latest run, or the limit of saved emails was reached). Sync or upload again.");
  }
  return stored;
}

/**
 * "This is a receipt": runs a skipped email through extraction as a receipt (the classifier's skip is overridden),
 * merges the result through the normal matcher and rules, records a class label and an audit row, and removes the
 * email from the skipped list. If extraction cannot run (no key, provider down) the label is still saved, the email
 * stays in the list, and the error says so; the label also makes the next sync treat the email as a receipt.
 */
export async function markSkippedAsReceipt(emailId: string, options: ReceiptFeedbackOptions = {}): Promise<ReceiptFeedbackResult> {
  const data = getQualityData();
  const entry = data.skipped.find((candidate) => candidate.emailId === emailId);
  if (!entry) throw new QualityError(404, "That email is not in the skipped list.");
  const stored = requireText(emailId);
  requireLedger();
  const receiptClass = options.class ?? (isReceiptClass(stored.classification?.class) ? stored.classification!.class : "order");
  if (!isReceiptClass(receiptClass)) throw new QualityError(400, "Choose a receipt class (order, shipped, refund, ...).");
  const work = beginStoreWork();
  // Stored text may come from a run under another mode: re-prepare it for the current one before it reaches Claude.
  const redacted = prepareForLlm(redactedEmailOf(stored), options.redaction);
  const at = options.now ?? new Date();
  const scope = currentStoreScope();
  const labels = options.labels ?? labelStore();
  const saveLabel = () => {
    labels.upsert(scope, labelOf(stored, receiptClass, "feedback", null, at));
    work.appendAudit({ at: at.toISOString(), type: "approval", detail: `Marked email ${emailId} as a receipt (${receiptClass}); saved as a quality label` });
  };

  let result;
  try {
    result = await extract(redacted, { emailId, class: receiptClass, confidence: 1, reason: "set by the user" }, {
      cache: getExtractionCache(), llm: options.llm, now: () => at,
      audit: (auditEntry) => work.appendAudit(llmCallAuditEvent(auditEntry, redacted)),
    });
  } catch (error) {
    if (!work.isCurrent()) throw new QualityError(409, "Your data was deleted while this was running; nothing was saved.");
    saveLabel();
    const unavailable = error instanceof LlmUnavailableError;
    throw new QualityError(unavailable ? 503 : 502,
      unavailable
        ? "Claude is not configured (ANTHROPIC_API_KEY), so the email was not extracted. Your correction was saved and will apply on the next sync."
        : `Extraction failed${error instanceof LlmError ? " (the AI provider did not answer)" : ""}. Your correction was saved; try again or sync again.`,
      { labeled: true });
  }
  if (!work.isCurrent()) throw new QualityError(409, "Your data was deleted while this was running; nothing was saved.");
  saveLabel();

  const removeFromSkipped = () => { data.skipped = data.skipped.filter((candidate) => candidate.emailId !== emailId); };
  const previous = { outcome: stored.outcome, class: stored.classification?.class };
  if (!result.ok) {
    const reason = ("reason" in result ? result.reason : "extraction skipped").slice(0, 200);
    updateLedgerResult(entry.accountId, (current) => {
      const reviewQueue = [...current.reviewQueue.filter((item) => item.emailId !== emailId || item.orderId), { emailId, stage: "extract" as const, reason }];
      return { ...current, reviewQueue, stats: { ...current.stats, needsReview: reviewQueue.length } };
    });
    stored.outcome = "extraction_failed";
    removeFromSkipped();
    return { emailId, class: receiptClass, extracted: false, needsReview: true, orderId: null, excludedMerchant: false, labeled: true };
  }

  const clock = ledgerClock(options);
  const excludedMerchants = getExcludedMerchants();
  let added: ReturnType<typeof addExtractionToResult> | undefined;
  updateLedgerResult(entry.accountId, (current) => {
    const outcome = addExtractionToResult(current, redacted, result.extraction, { ...clock, excludedMerchants, previous });
    added ??= outcome;
    return outcome.result;
  });
  stored.outcome = "extracted";
  stored.classification = { class: receiptClass, confidence: 1, reason: "set by the user" };
  removeFromSkipped();
  return {
    emailId, class: receiptClass, extracted: true, needsReview: result.extraction.confMin < REVIEW_CONFIDENCE_THRESHOLD || Boolean(added?.orderId && getState().orders.find((order) => order.id === added?.orderId)?.needsReview),
    orderId: added?.orderId ?? null, excludedMerchant: added?.excluded ?? false, labeled: true,
  };
}

/**
 * "Not a receipt": for an email that became (part of) an order or a review item. Removes its order when it was the
 * order's only email, records a class label and an audit row, and lists the email as skipped. An order that also
 * holds other emails is left alone (reported in `keptSharedOrders`) because its share can't be un-merged.
 */
export async function markNotReceipt(emailId: string, options: FeedbackOptions = {}): Promise<NotReceiptFeedbackResult> {
  const data = getQualityData();
  const stored = requireText(emailId);
  if (data.skipped.some((entry) => entry.emailId === emailId)) throw new QualityError(409, "That email is already skipped.");
  const state = requireLedger();
  const previous = { outcome: stored.outcome, class: stored.classification?.class };
  const preview = removeEmailFromResult(
    { orders: state.orders, findings: state.findings, reviewQueue: state.reviewQueue,
      stats: state.stats ?? { emails: 0, prefilteredOut: 0, classes: {}, extracted: 0, skipped: 0, extractionOrigins: { llm: 0, cache: 0, gold: 0 }, orders: 0, excludedOrders: 0, findings: 0, needsReview: 0 } },
    emailId, previous,
  );
  const at = options.now ?? new Date();
  (options.labels ?? labelStore()).upsert(currentStoreScope(), labelOf(stored, "not_receipt", "feedback", null, at));
  appendAudit({ at: at.toISOString(), type: "approval", detail: `Marked email ${emailId} as not a receipt; saved as a quality label` });
  if (preview.keptSharedOrders > 0) return { emailId, removedOrders: 0, keptSharedOrders: preview.keptSharedOrders, labeled: true };

  updateLedgerResult(stored.accountId, (current) => removeEmailFromResult(current, emailId, previous).result);
  const skipped: SkippedEmail = {
    emailId, ...(stored.accountId ? { accountId: stored.accountId } : {}), from: { name: stored.fromName, domain: stored.fromDomain },
    subject: stored.subject, date: stored.date, reason: "not_receipt", classConfidence: 1,
  };
  data.skipped = [...data.skipped, skipped];
  stored.outcome = "skipped";
  stored.classification = { class: "not_receipt", confidence: 1, reason: "set by the user" };
  return { emailId, removedOrders: preview.removedOrders, keptSharedOrders: 0, labeled: true };
}

function orderFields(order: NormalizedOrder): Partial<ExtractedFields> {
  return {
    merchant: order.merchant.name,
    ...(order.merchant.domain ? { merchantDomain: order.merchant.domain } : {}),
    orderRef: order.orderRef,
    date: order.placedAt,
    currency: order.currency,
    lineItems: order.lineItems.map((item) => ({ name: item.name, ...(item.sku ? { sku: item.sku } : {}), qty: item.qty, unitPrice: item.unitPrice })),
    totals: { subtotal: order.subtotal, tax: order.tax, shipping: order.shipping, discount: order.discount, total: order.total },
  };
}

function editedFields(order: NormalizedOrder, edit: ReviewEdit, previous: Partial<ExtractedFields> | null): Partial<ExtractedFields> {
  switch (edit.field) {
    case "merchantName": return { merchant: order.merchant.name };
    case "orderRef": return { orderRef: order.orderRef };
    case "placedAt": return { date: order.placedAt };
    case "currency": return { currency: order.currency };
    case "total": case "subtotal": case "tax": case "shipping": case "discount":
      return { totals: { ...previous?.totals, [edit.field]: order[edit.field] } };
    case "lineItemName": case "lineItemQty": case "lineItemUnitPrice": return { lineItems: orderFields(order).lineItems };
  }
}

/**
 * Review hook: saves a person's edit or confirmation as a label (#117). Only orders built from one email are
 * labeled (a merged order's fields cannot be pinned on a single email), and only when that email's redacted text was
 * kept from the run. An edit labels just the edited field; a confirmation labels every field shown. Never throws:
 * review must keep working when the label store is unavailable.
 */
export function recordReviewLabel(order: NormalizedOrder, action: "edit" | "confirm", edit?: ReviewEdit, options: FeedbackOptions = {}): boolean {
  try {
    if (order.messageIds.length !== 1) return false;
    const stored = getQualityData().texts.get(order.messageIds[0]);
    if (!stored) return false;
    const labels = options.labels ?? labelStore();
    const scope = currentStoreScope();
    const existing = labels.get(scope, stored.emailId);
    const known = stored.classification?.class;
    const cls = existing?.class && isReceiptClass(existing.class) ? existing.class : isReceiptClass(known) ? known : "order";
    const fields = action === "confirm" || !edit ? orderFields(order) : { ...existing?.fields, ...editedFields(order, edit, existing?.fields ?? null) };
    labels.upsert(scope, labelOf(stored, cls, existing?.source === "feedback" ? "feedback" : "review", fields, options.now ?? new Date()));
    return true;
  } catch {
    return false;
  }
}

