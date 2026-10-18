import { randomUUID } from "node:crypto";
import { NormalizedOrderSchema, type Finding, type NormalizedOrder } from "@/lib/contracts";
import type { PipelineResult, ReviewQueueItem } from "@/lib/pipeline/run";
import { compareFindings, defaultRules, findingId, runRulesIsolated } from "@/lib/rules";
import type { OverrideRecord } from "./override-store";
import type { ReviewEdit } from "./schema";

/** Applies one Review edit to an order; undefined when it targets a line item the order does not have. */
export function applyReviewEdit(order: NormalizedOrder, edit: ReviewEdit): NormalizedOrder | undefined {
  switch (edit.field) {
    case "merchantName": return { ...order, merchant: { ...order.merchant, name: edit.value } };
    case "orderRef": return { ...order, orderRef: edit.value };
    case "placedAt": return { ...order, placedAt: edit.value };
    case "currency": return { ...order, currency: edit.value };
    case "total": case "subtotal": case "tax": case "shipping": case "discount":
      return { ...order, [edit.field]: edit.value };
    case "lineItemName": case "lineItemQty": case "lineItemUnitPrice": {
      if (!order.lineItems.some(item => item.id === edit.lineItemId)) return undefined;
      const field = { lineItemName: "name", lineItemQty: "qty", lineItemUnitPrice: "unitPrice" }[edit.field];
      return { ...order, lineItems: order.lineItems.map(item => item.id === edit.lineItemId ? { ...item, [field]: edit.value } : item) };
    }
  }
}

/** A corrected order must still be a valid order: schema, finite non-negative amounts, returned quantities within quantities. */
export function isValidReviewedOrder(order: NormalizedOrder): boolean {
  const amounts = [order.total, order.subtotal, order.tax, order.shipping, order.discount];
  return NormalizedOrderSchema.safeParse(order).success &&
    !amounts.some(amount => amount !== null && (!Number.isFinite(amount) || amount < 0)) &&
    !order.lineItems.some(item => item.returnedQty > item.qty || !Number.isFinite(item.unitPrice));
}

/** Sorted, de-duplicated field names for `review.correctedFields`. */
export function correctedFieldNames(fields: readonly string[]): string[] {
  return [...new Set(fields)].sort();
}

/**
 * Re-keys records saved under an order id that dedup later merged away (`aliasIds`, #126) to the order that absorbed it,
 * including the line item and finding ids derived from the old order id. Records of ids that still exist are untouched;
 * an order's own records come after the re-keyed ones, so they win. Nothing is stored: every sync re-derives this.
 */
function rekeyAliasedRecords(result: PipelineResult, overrides: readonly OverrideRecord[]): OverrideRecord[] {
  const orderIds = new Set(result.orders.map(order => order.id));
  const target = new Map<string, NormalizedOrder>();
  const findingTarget = new Map<string, string>();
  for (const order of result.orders) {
    for (const alias of order.aliasIds ?? []) if (!orderIds.has(alias)) target.set(alias, order);
  }
  if (target.size === 0) return [...overrides];
  for (const finding of result.findings) {
    const order = result.orders.find(candidate => candidate.id === finding.orderId);
    for (const alias of order?.aliasIds ?? []) {
      const lineItemId = finding.lineItemId?.replace(`${finding.orderId}:li:`, `${alias}:li:`);
      findingTarget.set(findingId(finding.kind, alias, lineItemId), finding.id);
    }
  }
  const aliased: OverrideRecord[] = [];
  const own: OverrideRecord[] = [];
  for (const record of overrides) {
    if (record.kind === "finding") {
      const to = findingTarget.get(record.findingId);
      (to ? aliased : own).push(to ? { ...record, findingId: to } : record);
      continue;
    }
    const order = target.get(record.orderId);
    if (!order) { own.push(record); continue; }
    if (record.kind === "edit" && "lineItemId" in record.edit) {
      const lineItemId = record.edit.lineItemId.replace(`${record.orderId}:li:`, `${order.id}:li:`);
      aliased.push({ ...record, orderId: order.id, edit: { ...record.edit, lineItemId } });
    } else aliased.push({ ...record, orderId: order.id });
  }
  return [...aliased, ...own];
}

export interface OverrideReport {
  /** Records applied to orders and findings whose values changed in this call (0 when everything was already applied). */
  applied: number;
  /** Records whose target is not in this result (order, line item or finding absent). They stay stored for a later sync. */
  orphaned: number;
}

const PENDING_REASON = "Corrected order awaiting human confirmation";

/**
 * Re-applies the user's durable Review decisions (#124) to a pipeline result BEFORE anything is counted: edited fields
 * win over the fresh extraction, rules then run again for the changed orders only (so corrected amounts and dates flow
 * into findings and the owed total deterministically), confirmed orders are counted as confirmed, and resolved /
 * dismissed findings keep their status. An edit without a later confirmation leaves the order awaiting review, exactly
 * like the live Review flow. Idempotent: applying the same overrides to an already corrected result returns the same
 * order objects (so their review revisions stay valid) and reports `applied: 0`. Pure: `now` is the rule clock.
 */
export function applyOverrides(
  result: PipelineResult,
  overrides: readonly OverrideRecord[],
  ctx: { now: Date },
): { result: PipelineResult; report: OverrideReport } {
  if (overrides.length === 0) return { result, report: { applied: 0, orphaned: 0 } };
  overrides = rekeyAliasedRecords(result, overrides);
  const edits = new Map<string, Array<Extract<OverrideRecord, { kind: "edit" }>>>();
  const confirms = new Map<string, Extract<OverrideRecord, { kind: "confirm" }>>();
  const findingStatuses = new Map<string, Extract<OverrideRecord, { kind: "finding" }>["status"]>();
  for (const record of overrides) {
    if (record.kind === "edit") edits.set(record.orderId, [...(edits.get(record.orderId) ?? []), record]);
    else if (record.kind === "confirm") confirms.set(record.orderId, record);
    else findingStatuses.set(record.findingId, record.status);
  }

  let applied = 0;
  let orphaned = 0;
  const orderIds = new Set(result.orders.map(order => order.id));
  for (const [orderId, records] of edits) if (!orderIds.has(orderId)) orphaned += records.length;
  for (const orderId of confirms.keys()) if (!orderIds.has(orderId)) orphaned += 1;

  const changedIds = new Set<string>();
  const orders = result.orders.map(order => {
    const orderEdits = edits.get(order.id) ?? [];
    const confirm = confirms.get(order.id);
    if (orderEdits.length === 0 && !confirm) return order;
    let next = order;
    const fields: string[] = [];
    for (const { edit } of orderEdits) {
      const edited = applyReviewEdit(next, edit);
      if (edited && isValidReviewedOrder(edited)) { next = edited; fields.push(edit.field); } else orphaned += 1;
    }
    if (fields.length === 0 && !confirm) return order;
    const correctedFields = correctedFieldNames([...(order.review?.correctedFields ?? []), ...fields]);
    const review = {
      revision: order.review?.revision ?? randomUUID(),
      ...(confirm ? { confirmedAt: confirm.confirmedAt } : {}),
      ...(correctedFields.length > 0 ? { correctedFields } : {}),
    };
    next = { ...next, needsReview: !confirm, review };
    if (JSON.stringify(next) === JSON.stringify(order)) return order;
    applied += fields.length + (confirm ? 1 : 0);
    changedIds.add(order.id);
    return next;
  });

  let findings = result.findings;
  let reviewQueue = result.reviewQueue;
  let finalOrders = orders;
  if (changedIds.size > 0) {
    const changed = orders.filter(order => changedIds.has(order.id));
    const rules = runRulesIsolated(changed, defaultRules, { now: ctx.now });
    const failed = new Set(rules.failures.map(failure => failure.orderId));
    finalOrders = orders.map(order => failed.has(order.id) ? { ...order, needsReview: true } : order);
    findings = [...result.findings.filter(finding => !changedIds.has(finding.orderId)), ...rules.findings].sort(compareFindings);
    reviewQueue = requeue(result.reviewQueue, finalOrders.filter(order => changedIds.has(order.id)), finalOrders, rules.failures);
  }

  const withStatuses: Finding[] = findings.map(finding => {
    const status = findingStatuses.get(finding.id);
    if (status === undefined || status === finding.status) return finding;
    applied += 1;
    return { ...finding, status };
  });
  const present = new Set(findings.map(finding => finding.id));
  for (const findingId of findingStatuses.keys()) if (!present.has(findingId)) orphaned += 1;

  if (changedIds.size === 0 && withStatuses.every((finding, index) => finding === findings[index])) {
    return { result, report: { applied, orphaned } };
  }
  return {
    result: {
      ...result, orders: finalOrders, findings: withStatuses, reviewQueue,
      stats: { ...result.stats, findings: withStatuses.length, needsReview: reviewQueue.length },
    },
    report: { applied, orphaned },
  };
}

/** Drops the changed orders' stale queue items and re-adds the pending / failed ones, as saveReviewedOrder does for one order. */
function requeue(
  queue: readonly ReviewQueueItem[],
  changed: readonly NormalizedOrder[],
  allOrders: readonly NormalizedOrder[],
  failures: ReadonlyArray<{ orderId: string; reason: string }>,
): ReviewQueueItem[] {
  const changedIds = new Set(changed.map(order => order.id));
  const kept = queue.filter(item => {
    if (item.orderId) return !changedIds.has(item.orderId);
    return !changed.some(order => order.messageIds.includes(item.emailId) &&
      !allOrders.some(other => !changedIds.has(other.id) && other.needsReview && other.messageIds.includes(item.emailId)));
  });
  for (const order of changed) {
    const failure = failures.find(candidate => candidate.orderId === order.id);
    if (failure) {
      kept.push({ emailId: order.messageIds[0] ?? order.id, stage: "rules", orderId: order.id,
        reason: `rules failed, no findings for this order: ${failure.reason}`.slice(0, 200) });
    } else if (order.needsReview) {
      kept.push({ orderId: order.id, emailId: order.messageIds[0] ?? order.id, stage: "match", reason: PENDING_REASON });
    }
  }
  return kept;
}
