import type { EmailClass, Finding, NormalizedOrder } from "@/lib/contracts";
import type { PipelineEmailOutcome, PipelineResult, PipelineStats, ReviewQueueItem } from "@/lib/pipeline/run";
import type { PriceFeed } from "@/lib/prices/feed";
import { defaultRules, runRulesIsolated } from "@/lib/rules";
import type { MarkedPurchaseSnapshot } from "./types";

/**
 * Pure ledger changes for "Not a purchase" (#134), applied by the store to the published ledger and to every stored
 * Gmail account result: take a whole order out, take one email's share out of an order, or put an order back.
 * Counters follow the emails (a removed email counts as skipped, not extracted); order-level counters are recomputed.
 */

export interface RulesClock {
  now: Date;
  priceFeed?: PriceFeed;
}

/** How an email was counted before it was marked (see MarkedPurchase.previousEmails). */
export type PreviousEmail = { outcome: PipelineEmailOutcome; class?: EmailClass };
export type PreviousEmailOf = (emailId: string) => PreviousEmail;

export interface PurchaseChange {
  result: PipelineResult;
  /** The order as it was before the change; undefined when the result did not hold it (nothing changed). */
  snapshot?: MarkedPurchaseSnapshot;
  /** The order left this result completely (otherwise only one email's share did). */
  removedOrder: boolean;
}

function finalize(stats: PipelineStats, orders: NormalizedOrder[], findings: Finding[], reviewQueue: ReviewQueueItem[]): PipelineResult {
  return { orders, findings, reviewQueue, stats: { ...stats, orders: orders.length, findings: findings.length, needsReview: reviewQueue.length } };
}

/** `direction` 1: the emails become "not a receipt"; -1: they go back to how they were counted. */
function shiftEmailCounters(stats: PipelineStats, emailIds: readonly string[], previousOf: PreviousEmailOf, direction: 1 | -1): PipelineStats {
  const classes = { ...stats.classes };
  let extracted = stats.extracted;
  let skipped = stats.skipped;
  let collapsed = 0;
  const bump = (name: EmailClass, by: number) => {
    const count = Math.max(0, (classes[name] ?? 0) + by);
    if (count === 0) delete classes[name];
    else classes[name] = count;
  };
  for (const emailId of emailIds) {
    const previous = previousOf(emailId);
    if (previous.class) bump(previous.class, -direction);
    bump("not_receipt", direction);
    if (previous.outcome === "extracted") extracted -= direction;
    if (previous.outcome === "collapsed") collapsed += direction;
    skipped += direction;
  }
  const dedup = stats.dedup && collapsed !== 0 ? { ...stats.dedup, emailsCollapsed: Math.max(0, stats.dedup.emailsCollapsed - collapsed) } : stats.dedup;
  return { ...stats, classes, extracted: Math.max(0, extracted), skipped: Math.max(0, skipped), ...(dedup ? { dedup } : {}) };
}

const isOrderItem = (item: ReviewQueueItem, orderId: string, emailIds: readonly string[]) =>
  item.orderId === orderId || (!item.orderId && emailIds.includes(item.emailId));

/** Takes a whole order out: the order, its findings, and the review items about it or its emails. */
export function removeOrderFromResult(result: PipelineResult, orderId: string, previousOf: PreviousEmailOf): PurchaseChange {
  const order = result.orders.find((candidate) => candidate.id === orderId);
  if (!order) return { result, removedOrder: false };
  const orders = result.orders.filter((candidate) => candidate.id !== orderId);
  const findings = result.findings.filter((finding) => finding.orderId !== orderId);
  const reviewQueue = result.reviewQueue.filter((item) => !isOrderItem(item, orderId, order.messageIds));
  const snapshot: MarkedPurchaseSnapshot = {
    order,
    findings: result.findings.filter((finding) => finding.orderId === orderId),
    reviewQueue: result.reviewQueue.filter((item) => isOrderItem(item, orderId, order.messageIds)),
  };
  const stats = shiftEmailCounters(result.stats, order.messageIds, previousOf, 1);
  return { result: finalize(stats, orders, findings, reviewQueue), snapshot, removedOrder: true };
}

const RETURN_EVENTS = new Set(["return_started", "return_dropped", "return_received"]);

/** Whole-order return events carry no line item ids; they cover every item. */
function coversItem(event: NormalizedOrder["events"][number], itemId: string): boolean {
  return !event.lineItemIds || event.lineItemIds.length === 0 || event.lineItemIds.includes(itemId);
}

/**
 * Takes one email's share out of an order that holds several emails: its events and its place in `messageIds`. Returned
 * quantities that only that email's return events explained go back to zero. Totals and items are not touched: callers
 * only offer this for emails that are timeline events, which never supply the order's amounts. Rules run again.
 * An order whose only email this is leaves entirely (removeOrderFromResult).
 */
export function removeEmailFromOrderResult(
  result: PipelineResult, orderId: string, emailId: string, previousOf: PreviousEmailOf, clock: RulesClock,
): PurchaseChange {
  const order = result.orders.find((candidate) => candidate.id === orderId);
  if (!order || !order.messageIds.includes(emailId)) return { result, removedOrder: false };
  if (order.messageIds.length === 1) return removeOrderFromResult(result, orderId, previousOf);

  const removedEvents = order.events.filter((event) => event.messageId === emailId);
  const events = order.events.filter((event) => event.messageId !== emailId);
  const lineItems = order.lineItems.map((item) => {
    const explainedByRemoved = removedEvents.some((event) => RETURN_EVENTS.has(event.type) && coversItem(event, item.id));
    const explainedByRest = events.some((event) => RETURN_EVENTS.has(event.type) && coversItem(event, item.id));
    return explainedByRemoved && !explainedByRest ? { ...item, returnedQty: 0 } : item;
  });
  let reduced: NormalizedOrder = { ...order, messageIds: order.messageIds.filter((id) => id !== emailId), events, lineItems };
  const rules = runRulesIsolated([reduced], defaultRules, clock);
  if (rules.failures.length > 0) reduced = { ...reduced, needsReview: true };

  const previousStatus = new Map(result.findings.map((finding) => [finding.id, finding.status]));
  const findings = [
    ...result.findings.filter((finding) => finding.orderId !== orderId),
    ...rules.findings.map((finding) => ({ ...finding, status: previousStatus.get(finding.id) ?? finding.status })),
  ];
  const reviewQueue = result.reviewQueue.filter((item) => !(item.emailId === emailId && !item.orderId) && !(item.orderId === orderId && item.stage === "rules"));
  if (rules.failures.length > 0) {
    reviewQueue.push({ emailId: reduced.messageIds[0], stage: "rules", orderId,
      reason: `rules failed, no findings for this order: ${rules.failures[0].reason}`.slice(0, 200) });
  }
  const snapshot: MarkedPurchaseSnapshot = {
    order,
    findings: result.findings.filter((finding) => finding.orderId === orderId),
    reviewQueue: result.reviewQueue.filter((item) => isOrderItem(item, orderId, order.messageIds)),
  };
  const orders = result.orders.map((candidate) => (candidate.id === orderId ? reduced : candidate));
  const stats = shiftEmailCounters(result.stats, [emailId], previousOf, 1);
  return { result: finalize(stats, orders, findings, reviewQueue), snapshot, removedOrder: false };
}

/**
 * Puts an order back as it was before it was marked (undoing a whole removal, or restoring the emails of a partial
 * one). Rules run again on it, so findings follow today's clock; each finding keeps the status it had.
 */
export function restoreOrderToResult(result: PipelineResult, snapshot: MarkedPurchaseSnapshot, previousOf: PreviousEmailOf, clock: RulesClock): PipelineResult {
  const { order } = snapshot;
  const current = result.orders.find((candidate) => candidate.id === order.id);
  const restoredEmails = order.messageIds.filter((emailId) => !current?.messageIds.includes(emailId));
  let restored = order;
  const rules = runRulesIsolated([restored], defaultRules, clock);
  if (rules.failures.length > 0) restored = { ...restored, needsReview: true };

  const statusBefore = new Map([...result.findings, ...snapshot.findings].map((finding) => [finding.id, finding.status]));
  const findings = [
    ...result.findings.filter((finding) => finding.orderId !== order.id),
    ...rules.findings.map((finding) => ({ ...finding, status: statusBefore.get(finding.id) ?? finding.status })),
  ];
  const orders = current
    ? result.orders.map((candidate) => (candidate.id === order.id ? restored : candidate))
    : [...result.orders, restored].sort((a, b) => a.placedAt.localeCompare(b.placedAt) || a.id.localeCompare(b.id));
  const reviewQueue = [
    ...result.reviewQueue.filter((item) => !isOrderItem(item, order.id, order.messageIds)),
    ...snapshot.reviewQueue.filter((item) => item.stage !== "rules"),
  ];
  if (rules.failures.length > 0) {
    reviewQueue.push({ emailId: restored.messageIds[0], stage: "rules", orderId: order.id,
      reason: `rules failed, no findings for this order: ${rules.failures[0].reason}`.slice(0, 200) });
  }
  const stats = shiftEmailCounters(result.stats, restoredEmails, previousOf, -1);
  return finalize(stats, orders, findings, reviewQueue);
}
