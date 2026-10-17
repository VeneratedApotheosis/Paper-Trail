import { randomUUID } from "node:crypto";
import { NormalizedOrderSchema, type NormalizedOrder } from "@/lib/contracts";
import { seedPriceFeed } from "@/lib/demo/seed";
import { defaultRules, runRules } from "@/lib/rules";
import { isExcludedMerchant } from "@/lib/pipeline/run";
import { appendAudit, getExcludedMerchants, getOrder, getState, saveReviewedOrder } from "@/lib/store";
import { orderNeedsReview } from "@/lib/view";
import type { ReviewEdit } from "./schema";

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
  switch (edit.field) {
    case "merchantName": return { ...order, merchant: { ...order.merchant, name: edit.value } };
    case "orderRef": return { ...order, orderRef: edit.value };
    case "placedAt": return { ...order, placedAt: edit.value };
    case "currency": return { ...order, currency: edit.value };
    case "total": case "subtotal": case "tax": case "shipping": case "discount":
      return { ...order, [edit.field]: edit.value };
    case "lineItemName": case "lineItemQty": case "lineItemUnitPrice": {
      if (!order.lineItems.some(item => item.id === edit.lineItemId)) throw new ReviewError(404, "Line item not found.");
      const field = { lineItemName: "name", lineItemQty: "qty", lineItemUnitPrice: "unitPrice" }[edit.field];
      return { ...order, lineItems: order.lineItems.map(item => item.id === edit.lineItemId ? { ...item, [field]: edit.value } : item) };
    }
  }
}
function commitReview(order: NormalizedOrder, action: "edit" | "confirm", at: Date, field?: string) {
  const parsed = NormalizedOrderSchema.safeParse(order);
  const amounts = [order.total, order.subtotal, order.tax, order.shipping, order.discount];
  if (!parsed.success || amounts.some(amount => amount !== null && (!Number.isFinite(amount) || amount < 0)) ||
      order.lineItems.some(item => item.returnedQty > item.qty || !Number.isFinite(item.unitPrice))) {
    throw new ReviewError(422, "Corrected order is invalid; check quantities and amounts.");
  }
  if (isExcludedMerchant(order, getExcludedMerchants())) throw new ReviewError(409, "This merchant is excluded.");
  const state = getState();
  // Demo uses its fixed as-of and simulated feed. Live/upload data never gets seed prices.
  const ruleNow = state.mode === "demo" && state.asOf ? new Date(state.asOf) : at;
  const findings = runRules([parsed.data], defaultRules, {
    now: ruleNow, ...(state.mode === "demo" ? { priceFeed: seedPriceFeed } : {}),
  });
  saveReviewedOrder(parsed.data, findings);
  appendAudit({ at: at.toISOString(), type: "approval",
    detail: action === "edit" ? `Review edit saved: order ${order.id}, field ${field}, revision ${order.review?.revision}`
      : `Review confirmed: order ${order.id}, revision ${order.review?.revision}` });
  return { order: parsed.data, findings, revision: order.review!.revision };
}
export function editReviewedOrder(id: string, revision: string, edit: ReviewEdit, at: Date = new Date()) {
  const original = currentOrder(id, revision);
  const order = { ...applyEdit(original, edit), needsReview: true, review: { revision: randomUUID() } };
  return commitReview(order, "edit", at, edit.field);
}
export function confirmReviewedOrder(id: string, revision: string, at: Date = new Date()) {
  const original = currentOrder(id, revision);
  // Same revision confirmation is idempotent; retries do not create extra approvals.
  if (original.review?.confirmedAt && !original.needsReview) {
    return { order: original, findings: getState().findings.filter(f => f.orderId === id), revision };
  }
  const order = { ...original, needsReview: false,
    review: { revision, confirmedAt: at.toISOString() } };
  return commitReview(order, "confirm", at);
}
