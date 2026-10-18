import { randomUUID } from "node:crypto";
import { NormalizedOrderSchema, type FindingStatus, type NormalizedOrder } from "@/lib/contracts";
import { seedPriceFeed } from "@/lib/demo/seed";
import { defaultRules, runRules } from "@/lib/rules";
import { isExcludedMerchant } from "@/lib/pipeline/run";
import { appendAudit, currentStoreScope, getExcludedMerchants, getOrder, getState, saveReviewedOrder } from "@/lib/store";
import { recordReviewLabel } from "@/lib/quality/feedback";
import { orderNeedsReview } from "@/lib/view";
import { recordOverride, type OverrideRecord } from "./override-store";
import { applyReviewEdit, correctedFieldNames, isValidReviewedOrder } from "./overrides";
import type { ReviewEdit } from "./schema";

// Pending edits intentionally emit no findings. Keep only their prior statuses,
// keyed by the actual stored order snapshot (not IDs shared across accounts).
// Weak keys release history after replacement/deletion; globalThis keeps it
// shared across Next's edit/confirm route bundles and development hot reloads.
const HISTORY_KEY = Symbol.for("papertrail.review.pendingStatuses");
const holder = globalThis as typeof globalThis & {
  [HISTORY_KEY]?: WeakMap<NormalizedOrder, Map<string, FindingStatus>>;
};
const pendingStatuses = holder[HISTORY_KEY] ??= new WeakMap<NormalizedOrder, Map<string, FindingStatus>>();
const RECEIPTS_KEY = Symbol.for("papertrail.review.confirmReceipts");
const receiptsHolder = globalThis as typeof globalThis & { [RECEIPTS_KEY]?: WeakMap<NormalizedOrder, string> };
// Retry receipts belong to the exact confirmed snapshot. Editing/replacing it
// invalidates the receipt, so an old confirmation cannot confirm newer changes.
const confirmReceipts = receiptsHolder[RECEIPTS_KEY] ??= new WeakMap<NormalizedOrder, string>();

export class ReviewError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
function currentOrder(id: string, revision: string) {
  const order = getOrder(id);
  if (!order) throw new ReviewError(404, "Order not found.");
  if (order.review?.revision !== revision) throw new ReviewError(409, "Order changed; reload the review before continuing.");
  if (!orderNeedsReview(order) && !order.review?.confirmedAt) throw new ReviewError(409, "Order is not awaiting review.");
  return order;
}
function applyEdit(order: NormalizedOrder, edit: ReviewEdit): NormalizedOrder {
  const edited = applyReviewEdit(order, edit);
  if (!edited) throw new ReviewError(404, "Line item not found.");
  return edited;
}
/** #124: the correction or confirmation survives later syncs, uploads and restarts of this profile. */
function saveDurableOverride(order: NormalizedOrder, action: "edit" | "confirm", at: Date, edit?: ReviewEdit) {
  const emailId = order.messageIds[0];
  const record: OverrideRecord | undefined = action === "edit" && edit
    ? { kind: "edit", orderId: order.id, edit, ...(emailId ? { emailId } : {}), at: at.toISOString() }
    : action === "confirm" && order.review?.confirmedAt
      ? { kind: "confirm", orderId: order.id, confirmedAt: order.review.confirmedAt, ...(emailId ? { emailId } : {}), at: at.toISOString() }
      : undefined;
  if (record && !recordOverride(currentStoreScope(), record)) {
    appendAudit({ at: at.toISOString(), type: "approval",
      detail: `Review ${action} for order ${order.id} was applied now, but could not be saved for later syncs` });
  }
}
function commitReview(original: NormalizedOrder, order: NormalizedOrder, action: "edit" | "confirm", at: Date, field?: string, edit?: ReviewEdit) {
  const parsed = NormalizedOrderSchema.safeParse(order);
  if (!parsed.success || !isValidReviewedOrder(order)) {
    throw new ReviewError(422, "Corrected order is invalid; check quantities and amounts.");
  }
  if (isExcludedMerchant(order, getExcludedMerchants())) throw new ReviewError(409, "This merchant is excluded.");
  const state = getState();
  const previousStatuses = new Map(pendingStatuses.get(original));
  for (const finding of state.findings) {
    if (finding.orderId === order.id) previousStatuses.set(finding.id, finding.status);
  }
  // Demo uses its fixed as-of and simulated feed. Live/upload data never gets seed prices.
  const ruleNow = state.mode === "demo" && state.asOf ? new Date(state.asOf) : at;
  const findings = runRules([parsed.data], defaultRules, {
    now: ruleNow, ...(state.mode === "demo" ? { priceFeed: seedPriceFeed } : {}),
  }).map(finding => ({ ...finding, status: previousStatuses.get(finding.id) ?? finding.status }));
  saveReviewedOrder(parsed.data, findings);
  recordReviewLabel(parsed.data, action, edit); // #117: corrections become labeled examples (best effort, never throws)
  if (state.mode !== "demo") saveDurableOverride(parsed.data, action, at, edit); // #124: demo edits are not kept across loads
  pendingStatuses.delete(original);
  if (action === "edit") pendingStatuses.set(parsed.data, previousStatuses);
  appendAudit({ at: at.toISOString(), type: "approval",
    detail: action === "edit" ? `Review edit saved: order ${order.id}, field ${field}, revision ${order.review?.revision}`
      : `Review confirmed: order ${order.id}, revision ${order.review?.revision}` });
  return { order: parsed.data, findings, revision: order.review!.revision };
}
export function editReviewedOrder(id: string, revision: string, edit: ReviewEdit, at: Date = new Date()) {
  const original = currentOrder(id, revision);
  const order = { ...applyEdit(original, edit), needsReview: true,
    review: { revision: randomUUID(), correctedFields: correctedFieldNames([...(original.review?.correctedFields ?? []), edit.field]) } };
  return commitReview(original, order, "edit", at, edit.field, edit);
}
export function confirmReviewedOrder(id: string, revision: string, at: Date = new Date()) {
  const current = getOrder(id);
  // Both the returned revision and the immediately preceding confirmation
  // request can be retried, but never used to edit the confirmed snapshot.
  if (current?.review?.confirmedAt && !current.needsReview &&
      (current.review.revision === revision || confirmReceipts.get(current) === revision)) {
    return { order: current, findings: getState().findings.filter(f => f.orderId === id), revision: current.review.revision };
  }
  const original = currentOrder(id, revision);
  const order = { ...original, needsReview: false,
    review: { revision: randomUUID(), confirmedAt: at.toISOString(),
      ...(original.review?.correctedFields ? { correctedFields: original.review.correctedFields } : {}) } };
  const result = commitReview(original, order, "confirm", at);
  confirmReceipts.set(result.order, revision);
  return result;
}
