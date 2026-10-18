import type { NormalizedOrder } from "@/lib/contracts";
import { sanitizedFrom } from "./text";
import { appendAudit, currentStoreScope, getQualityData, getState, updateLedgerEverywhere, upsertDraft } from "@/lib/store";
import { QualityError, labelOf, ledgerClock, type FeedbackOptions } from "./feedback";
import { labelStore, type LabelStore } from "./labels";
import {
  removeEmailFromOrderResult, removeOrderFromResult, restoreOrderToResult, type PreviousEmailOf, type PurchaseChange,
} from "./purchase-contribution";
import type { MarkedPurchase, MarkedPurchaseSnapshot, QualityLabel, SkippedEmail, StoredEmailText } from "./types";

/**
 * "Not a purchase" (#134): the user says an order in the ledger is not a purchase (a bank notice, a classifier miss), or
 * that one email of an order is not about it. The emails get a `not_receipt` label (the class override every later sync
 * of any account applies by email id, so it also holds when dedup moves an email to another order), the ledger and
 * every stored Gmail account result lose the order (or the email's share), owed recomputes, and one audit row is
 * written. Undo (`restoreOrder`) puts the order back from an in-memory snapshot and restores the labels it replaced.
 */

type MarkOptions = Pick<FeedbackOptions, "now" | "labels">;

export interface NotPurchaseResult {
  orderId: string;
  merchant: string;
  /** Emails now labeled "not a receipt". */
  emailIds: string[];
  removedFindings: number;
}

export interface NotAboutOrderResult {
  orderId: string;
  emailId: string;
  /** The email was the order's only one, so the whole order went. */
  removedOrder: boolean;
  /** Findings left on the order after the change. */
  findings: number;
}

export interface RestoreOrderResult {
  orderId: string;
  merchant: string;
  /** Emails whose "not a receipt" label was removed or put back to what it was. */
  emailIds: string[];
  findings: number;
}

function markedPurchases(): Map<string, MarkedPurchase> {
  const quality = getQualityData();
  return (quality.marked ??= new Map());
}

function requireOrder(orderId: string): NormalizedOrder {
  const state = getState();
  if (state.mode === "empty") throw new QualityError(409, "There is no ledger to update; sync, upload or load the demo first.");
  const order = state.orders.find((candidate) => candidate.id === orderId);
  if (!order) throw new QualityError(404, "Order not found");
  return order;
}

/** How an email is counted right now (an email without saved text came from an extraction, so it counts as extracted). */
function previousEmailOf(emailId: string): MarkedPurchase["previousEmails"][number] {
  const stored = getQualityData().texts.get(emailId);
  return { emailId, outcome: stored?.outcome ?? "extracted", classification: stored?.classification ?? null };
}

const previousClassOf = (previous: readonly MarkedPurchase["previousEmails"][number][]): PreviousEmailOf => {
  const byEmail = new Map(previous.map((entry) => [entry.emailId, entry]));
  return (emailId) => {
    const entry = byEmail.get(emailId) ?? previousEmailOf(emailId);
    return { outcome: entry.outcome, ...(entry.classification ? { class: entry.classification.class } : {}) };
  };
};

/** The timeline event an email supplied. The "placed" event (#127) belongs to the confirmation, which supplies the amounts, so it does not count. */
function eventOf(order: NormalizedOrder, emailId: string) {
  return order.events.find((event) => event.messageId === emailId && event.type !== "placed");
}

/** The "not a receipt" label of one email. Without saved text only the class override is stored (no text to score). */
function notReceiptLabel(order: NormalizedOrder, emailId: string, at: Date): QualityLabel {
  const stored = getQualityData().texts.get(emailId);
  if (stored) return labelOf(stored, "not_receipt", "feedback", null, at);
  return {
    emailId, ...(order.sources?.length === 1 ? { accountId: order.sources[0] } : {}), source: "feedback", class: "not_receipt", fields: null,
    redactedText: "", textHash: "", subject: `${order.merchant.name}${order.orderRef ? ` order ${order.orderRef}` : ""}`,
    from: sanitizedFrom({ name: order.merchant.name, domain: order.merchant.domain }), date: eventOf(order, emailId)?.at ?? order.placedAt,
    at: at.toISOString(),
  };
}

function skippedEntryOf(label: QualityLabel, stored: StoredEmailText | undefined): SkippedEmail {
  return {
    emailId: label.emailId, ...(label.accountId ? { accountId: label.accountId } : {}),
    from: stored ? { name: stored.fromName, domain: stored.fromDomain } : { name: null, domain: null },
    subject: label.subject, date: label.date, reason: "marked_not_purchase", classConfidence: 1,
  };
}

/** The label, the skipped-list row and the saved text's state for each newly marked email. */
function recordEmailsAsNotReceipt(order: NormalizedOrder, emailIds: readonly string[], labels: LabelStore, at: Date): void {
  const quality = getQualityData();
  const scope = currentStoreScope();
  const marked = new Set(emailIds);
  const entries: SkippedEmail[] = [];
  for (const emailId of emailIds) {
    const label = notReceiptLabel(order, emailId, at);
    labels.upsert(scope, label);
    const stored = quality.texts.get(emailId);
    entries.push(skippedEntryOf(label, stored));
    if (stored) {
      stored.outcome = "skipped";
      stored.classification = { class: "not_receipt", confidence: 1, reason: "set by the user" };
    }
  }
  quality.skipped = [...quality.skipped.filter((entry) => !marked.has(entry.emailId)), ...entries];
}

function snapshotCollector() {
  const snapshots: MarkedPurchaseSnapshot[] = [];
  return {
    snapshots,
    collect(change: PurchaseChange, accountId: string | undefined) {
      if (change.snapshot) snapshots.push({ ...change.snapshot, ...(accountId ? { accountId } : {}) });
      return change.result;
    },
  };
}

/** Keeps the oldest state per order: a second mark (partial, then whole) must still undo back to the original. */
function rememberMark(order: NormalizedOrder, emailIds: readonly string[], snapshots: MarkedPurchaseSnapshot[], context: {
  drafts: MarkedPurchase["drafts"]; previousLabels: QualityLabel[]; previousEmails: MarkedPurchase["previousEmails"]; at: Date;
}): void {
  const marked = markedPurchases();
  const existing = marked.get(order.id);
  if (!existing) {
    marked.set(order.id, {
      orderId: order.id, merchant: order.merchant.name, markedAt: context.at.toISOString(), emailIds: [...emailIds], snapshots,
      drafts: context.drafts, previousLabels: context.previousLabels, previousEmails: context.previousEmails,
    });
    return;
  }
  const known = new Set(existing.emailIds);
  const fresh = (emailId: string) => !known.has(emailId);
  existing.emailIds = [...existing.emailIds, ...emailIds.filter(fresh)];
  existing.previousLabels = [...existing.previousLabels, ...context.previousLabels.filter((label) => fresh(label.emailId))];
  existing.previousEmails = [...existing.previousEmails, ...context.previousEmails.filter((entry) => fresh(entry.emailId))];
  existing.drafts = [...existing.drafts, ...context.drafts.filter((draft) => !existing.drafts.some((have) => have.id === draft.id))];
  existing.markedAt = context.at.toISOString();
}

function draftsOf(findingIds: ReadonlySet<string>) {
  return getState().drafts.filter((draft) => findingIds.has(draft.findingId));
}

function describe(order: NormalizedOrder): string {
  return `${order.merchant.name}${order.orderRef ? ` (order ${order.orderRef})` : ""}`;
}

/** "Not a purchase": every email of the order becomes "not a receipt", and the order and its findings leave the ledger. */
export function markOrderNotPurchase(orderId: string, options: MarkOptions = {}): NotPurchaseResult {
  const order = requireOrder(orderId);
  const at = options.now ?? new Date();
  const labels = options.labels ?? labelStore();
  const emailIds = [...new Set(order.messageIds)];
  const findingIds = new Set(getState().findings.filter((finding) => finding.orderId === orderId).map((finding) => finding.id));
  const context = {
    drafts: draftsOf(findingIds), at,
    previousLabels: emailIds.flatMap((emailId) => labels.get(currentStoreScope(), emailId) ?? []),
    previousEmails: emailIds.map(previousEmailOf),
  };
  const previousOf = previousClassOf(context.previousEmails);
  const collector = snapshotCollector();
  // Labels first, like the other feedback: if the ledger update were to fail, the next sync still honors the correction.
  recordEmailsAsNotReceipt(order, emailIds, labels, at);
  updateLedgerEverywhere((result, accountId) => collector.collect(removeOrderFromResult(result, orderId, previousOf), accountId));
  rememberMark(order, emailIds, collector.snapshots, context);
  appendAudit({ at: at.toISOString(), type: "approval",
    detail: `Marked ${describe(order)} as not a purchase: ${emailIds.length} ${emailIds.length === 1 ? "email" : "emails"} saved as "not a receipt" labels, ${findingIds.size} ${findingIds.size === 1 ? "finding" : "findings"} removed` });
  return { orderId, merchant: order.merchant.name, emailIds, removedFindings: findingIds.size };
}

/**
 * "Not about this purchase": one email of an order that holds several. Its events leave the order and rules run again;
 * the email is labeled "not a receipt". Only timeline emails qualify (their events carry no totals or items); an
 * email that is the order's only one removes the whole order, and the confirmation email that supplied the order's
 * amounts is refused (mark the whole purchase instead).
 */
export function markEmailNotAboutOrder(orderId: string, emailId: string, options: MarkOptions = {}): NotAboutOrderResult {
  const order = requireOrder(orderId);
  if (!order.messageIds.includes(emailId)) throw new QualityError(404, "That email is not part of this purchase.");
  if (order.messageIds.length === 1) {
    markOrderNotPurchase(orderId, options);
    return { orderId, emailId, removedOrder: true, findings: 0 };
  }
  if (!eventOf(order, emailId)) {
    throw new QualityError(409, "That email supplied this purchase's amounts and items. Mark the whole purchase as not a purchase instead.");
  }
  const at = options.now ?? new Date();
  const labels = options.labels ?? labelStore();
  const findingIds = new Set(getState().findings.filter((finding) => finding.orderId === orderId).map((finding) => finding.id));
  const previousLabel = labels.get(currentStoreScope(), emailId);
  const context = {
    drafts: draftsOf(findingIds), at,
    previousLabels: previousLabel ? [previousLabel] : [],
    previousEmails: [previousEmailOf(emailId)],
  };
  const previousOf = previousClassOf(context.previousEmails);
  const clock = ledgerClock(options);
  const collector = snapshotCollector();
  recordEmailsAsNotReceipt(order, [emailId], labels, at);
  updateLedgerEverywhere((result, accountId) => collector.collect(removeEmailFromOrderResult(result, orderId, emailId, previousOf, clock), accountId));
  rememberMark(order, [emailId], collector.snapshots, context);
  appendAudit({ at: at.toISOString(), type: "approval", detail: `Marked one email of ${describe(order)} as not about this purchase; saved as a "not a receipt" label` });
  return { orderId, emailId, removedOrder: false, findings: getState().findings.filter((finding) => finding.orderId === orderId).length };
}

/** Undo of either mark: the order comes back as it was, and the labels it set are removed (or put back as they were). */
export function restoreOrder(orderId: string, options: MarkOptions = {}): RestoreOrderResult {
  const marked = markedPurchases().get(orderId);
  if (!marked) {
    throw new QualityError(404, "Nothing to undo for this purchase. If an email was marked, use \"This is a receipt\" on the Quality page.");
  }
  if (getState().mode === "empty") throw new QualityError(409, "There is no ledger to update; sync, upload or load the demo first.");
  const at = options.now ?? new Date();
  const labels = options.labels ?? labelStore();
  const scope = currentStoreScope();
  labels.remove(scope, marked.emailIds);
  for (const label of marked.previousLabels) labels.upsert(scope, label);

  const previousOf = previousClassOf(marked.previousEmails);
  const clock = ledgerClock(options);
  const byAccount = new Map(marked.snapshots.map((snapshot) => [snapshot.accountId, snapshot]));
  updateLedgerEverywhere((result, accountId) => {
    const snapshot = byAccount.get(accountId);
    return snapshot ? restoreOrderToResult(result, snapshot, previousOf, clock) : result;
  });

  const quality = getQualityData();
  const restored = new Set(marked.emailIds);
  quality.skipped = quality.skipped.filter((entry) => !(restored.has(entry.emailId) && entry.reason === "marked_not_purchase"));
  for (const previous of marked.previousEmails) {
    const stored = quality.texts.get(previous.emailId);
    if (!stored) continue;
    stored.outcome = previous.outcome;
    stored.classification = previous.classification;
  }
  const state = getState();
  const findingIds = new Set(state.findings.filter((finding) => finding.orderId === orderId).map((finding) => finding.id));
  for (const draft of marked.drafts) if (findingIds.has(draft.findingId)) upsertDraft(draft);
  markedPurchases().delete(orderId);
  appendAudit({ at: at.toISOString(), type: "approval",
    detail: `Undid "not a purchase" for ${marked.merchant}: ${marked.emailIds.length} ${marked.emailIds.length === 1 ? "email" : "emails"} counted again` });
  return { orderId, merchant: marked.merchant, emailIds: marked.emailIds, findings: findingIds.size };
}
