import {
  NormalizedOrderSchema,
  REVIEW_CONFIDENCE_THRESHOLD,
  type MerchantPolicy,
  type NormalizedLineItem,
  type NormalizedOrder,
  type OrderEvent,
} from "@/lib/contracts";

/**
 * Merges orders that the matcher built separately but that are the same order (same id: merchant + order ref),
 * e.g. one order seen in two linked Gmail inboxes (#114). Pure and deterministic; the result does not depend on the
 * order of `orders`.
 *
 * - The base is the most trustworthy copy: not flagged for review, then the most events, then the most emails.
 * - Events and line items are unioned (an event is a duplicate when type, day, amount and line items agree, the
 *   matcher's own rule); returned quantities take the larger value.
 * - Policy facts the base lacks are filled from the other copies; `nonReturnable` is set when any copy says so.
 * - Totals, currency and placed-at come from the base only, so amounts are never mixed across copies.
 * - `sources` and `messageIds` are unions; `confMin` is the lowest; the human review state is dropped (the store
 *   assigns a new revision when the merged order is published).
 */
export function mergeSameOrder(orders: readonly NormalizedOrder[]): NormalizedOrder {
  if (orders.length === 0) throw new Error("mergeSameOrder needs at least one order");
  const ranked = [...orders].sort(compareTrust);
  const [base, ...others] = ranked;
  if (others.length === 0) return base;
  const confMin = Math.min(...ranked.map((order) => order.confMin));
  const merged = NormalizedOrderSchema.parse({
    ...base,
    merchant: { ...base.merchant, policy: mergePolicy(ranked.map((order) => order.merchant.policy)) },
    orderRef: firstNonNull(ranked.map((order) => order.orderRef)),
    last4: firstNonNull(ranked.map((order) => order.last4)),
    customerName: firstNonNull(ranked.map((order) => order.customerName)),
    lineItems: mergeLineItems(ranked),
    events: mergeEvents(ranked),
    messageIds: [...new Set(ranked.flatMap((order) => order.messageIds))],
    sources: [...new Set(ranked.flatMap((order) => order.sources ?? []))].sort(),
    confMin,
    needsReview: base.needsReview || confMin < REVIEW_CONFIDENCE_THRESHOLD,
  });
  delete merged.review;
  return merged;
}

function compareTrust(a: NormalizedOrder, b: NormalizedOrder): number {
  return (
    Number(a.needsReview) - Number(b.needsReview) ||
    b.events.length - a.events.length ||
    b.messageIds.length - a.messageIds.length ||
    (a.sources ?? []).join(",").localeCompare((b.sources ?? []).join(",")) ||
    a.messageIds.join(",").localeCompare(b.messageIds.join(","))
  );
}

function firstNonNull<T>(values: readonly (T | null | undefined)[]): T | null {
  for (const value of values) if (value !== null && value !== undefined) return value;
  return null;
}

function mergePolicy(policies: readonly MerchantPolicy[]): MerchantPolicy {
  return {
    returnWindowDays: firstNonNull(policies.map((policy) => policy.returnWindowDays)),
    windowAnchor: firstNonNull(policies.map((policy) => policy.windowAnchor)),
    refundSlaDays: firstNonNull(policies.map((policy) => policy.refundSlaDays)),
    priceAdjustDays: firstNonNull(policies.map((policy) => policy.priceAdjustDays)),
    policySource: firstNonNull(policies.map((policy) => policy.policySource)),
    policyQuote: firstNonNull(policies.map((policy) => policy.policyQuote)),
    nonReturnable: policies.some((policy) => policy.nonReturnable),
  };
}

function mergeLineItems(ranked: readonly NormalizedOrder[]): NormalizedLineItem[] {
  const byId = new Map<string, NormalizedLineItem>();
  for (const item of ranked.flatMap((order) => order.lineItems)) {
    const existing = byId.get(item.id);
    byId.set(item.id, existing ? { ...existing, returnedQty: Math.max(existing.returnedQty, item.returnedQty) } : item);
  }
  return [...byId.values()];
}

function eventKey(event: OrderEvent): string {
  return `${event.type}|${event.at.slice(0, 10)}|${event.amount ?? ""}|${(event.lineItemIds ?? []).join(",")}`;
}

function mergeEvents(ranked: readonly NormalizedOrder[]): OrderEvent[] {
  const seen = new Set<string>();
  const events: OrderEvent[] = [];
  for (const event of ranked.flatMap((order) => order.events)) {
    const key = eventKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(event);
  }
  return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
}
