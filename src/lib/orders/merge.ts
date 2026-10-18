import {
  NormalizedOrderSchema,
  REVIEW_CONFIDENCE_THRESHOLD,
  type MerchantPolicy,
  type NormalizedLineItem,
  type NormalizedOrder,
  type OrderEvent,
  type PurchaseDetails,
} from "@/lib/contracts";
import { mergeShipments } from "./shipments";

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
 * - Orders with different ids (the same purchase matched by reference or email key, #126) are re-keyed to the base id; the
 *   other ids are kept in `aliasIds` so Review corrections saved under them still apply.
 * - A package-only entry (#127: tracking emails, no receipt) never is the base while a real order is present; its
 *   shipments and events join the order, the `packageOnly` flag goes away and the kind comes from the order, else
 *   from the package. Shipments are unioned by tracking number (the most advanced status wins).
 * - `sources` and `messageIds` are unions; `confMin` is the lowest; the human review state is dropped (the store
 *   assigns a new revision when the merged order is published).
 */
export function mergeSameOrder(orders: readonly NormalizedOrder[]): NormalizedOrder {
  if (orders.length === 0) throw new Error("mergeSameOrder needs at least one order");
  const ranked = [...orders].sort(compareTrust);
  const [base, ...others] = ranked;
  if (others.length === 0) return base;
  const confMin = Math.min(...ranked.map((order) => order.confMin));
  // Copies of one order that carry another id (matched by reference or email key, #126) are re-keyed to the base's id.
  const rebased = ranked.map((order) => rebaseOrder(order, base.id));
  const aliasIds = [...new Set(ranked.flatMap((order) => [order.id, ...(order.aliasIds ?? [])]))].filter((id) => id !== base.id).sort();
  const emailKeys = [...new Set(ranked.flatMap((order) => order.emailKeys ?? []))].sort();
  const possibleDuplicateOf = ranked.map((order) => order.possibleDuplicateOf).find((flag) => flag !== undefined && flag.orderId !== base.id && !aliasIds.includes(flag.orderId));
  const merged = NormalizedOrderSchema.parse({
    ...base,
    ...(aliasIds.length > 0 ? { aliasIds } : {}),
    ...(emailKeys.length > 0 ? { emailKeys } : {}),
    ...(possibleDuplicateOf ? { possibleDuplicateOf } : {}),
    merchant: { ...base.merchant, policy: mergePolicy(ranked.map((order) => order.merchant.policy)) },
    orderRef: firstNonNull(ranked.map((order) => order.orderRef)),
    last4: firstNonNull(ranked.map((order) => order.last4)),
    customerName: firstNonNull(ranked.map((order) => order.customerName)),
    lineItems: mergeLineItems(rebased),
    events: mergeEvents(rebased),
    messageIds: [...new Set(ranked.flatMap((order) => order.messageIds))],
    sources: [...new Set(ranked.flatMap((order) => order.sources ?? []))].sort(),
    ...mergedKind(ranked),
    confMin,
    needsReview: ranked.every((order) => order.packageOnly)
      ? ranked.some((order) => order.needsReview)
      : base.needsReview || confMin < REVIEW_CONFIDENCE_THRESHOLD,
  });
  if (!ranked.every((order) => order.packageOnly)) delete merged.packageOnly;
  if (!possibleDuplicateOf) delete merged.possibleDuplicateOf;
  delete merged.review;
  return merged;
}

/** The order with its id, line item ids and event ids moved under `baseId` (same order when the ids already agree). */
function rebaseOrder(order: NormalizedOrder, baseId: string): NormalizedOrder {
  if (order.id === baseId) return order;
  const rekey = (id: string) => (id.startsWith(`${order.id}:`) ? `${baseId}:${id.slice(order.id.length + 1)}` : id);
  return {
    ...order,
    id: baseId,
    lineItems: order.lineItems.map((item) => ({ ...item, id: rekey(item.id) })),
    events: order.events.map((event) => ({
      ...event,
      id: rekey(event.id),
      ...(event.lineItemIds ? { lineItemIds: event.lineItemIds.map(rekey) } : {}),
    })),
  };
}

/**
 * Kind and details of merged orders: the base's kind unless it is "other" (or missing) and another copy knows better;
 * shipments of every copy are kept whatever the kind (a package that arrived before its receipt was classified).
 */
function mergedKind(ranked: readonly NormalizedOrder[]): Pick<NormalizedOrder, "kind" | "details" | "packageOnly"> {
  const known = ranked.find((order) => order.kind !== undefined && order.kind !== "other") ?? ranked[0];
  const shipments = mergeShipments(ranked.map((order) => (order.details?.kind === "shipped" ? order.details.shipments : [])));
  const kind = known.kind;
  if (kind === undefined) return ranked.every((order) => order.packageOnly) ? { packageOnly: true } : {};
  const details: PurchaseDetails | undefined = kind === "shipped" ? { kind, shipments } : known.details;
  return { kind, ...(details ? { details } : {}), ...(ranked.every((order) => order.packageOnly) ? { packageOnly: true } : {}) };
}

function compareTrust(a: NormalizedOrder, b: NormalizedOrder): number {
  return (
    Number(a.packageOnly === true) - Number(b.packageOnly === true) ||
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
