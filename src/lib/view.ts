// Display-only helpers that derive UI fields from the canonical contracts.
// NormalizedOrder has no "status" field — status is derived from its events.
import type { Finding, NormalizedOrder, OrderEvent } from "@/lib/contracts";
import { computeOwed, countsTowardOwed, orderNeedsReview as rulesOrderNeedsReview } from "@/lib/rules/owed";
import type { OwedSummary } from "@/lib/types";

export type OrderDisplayStatus =
  | "ordered"
  | "shipped"
  | "delivered"
  | "return in progress"
  | "returned"
  | "refunded"
  | "cancelled";

const EVENT_TO_STATUS: Record<OrderEvent["type"], OrderDisplayStatus> = {
  placed: "ordered",
  shipped: "shipped",
  out_for_delivery: "shipped",
  ready_for_pickup: "shipped",
  delivered: "delivered",
  return_started: "return in progress",
  return_dropped: "return in progress",
  return_received: "returned",
  refund_issued: "refunded",
  store_credit: "refunded",
  price_adjust: "delivered",
  cancel: "cancelled",
};

// Latest event wins; no events means the order was just placed.
export function deriveOrderStatus(order: NormalizedOrder): OrderDisplayStatus {
  if (order.events.length === 0) return "ordered";
  const latest = [...order.events].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  )[order.events.length - 1];
  return EVENT_TO_STATUS[latest.type] ?? "ordered";
}

export function orderNeedsReview(order: NormalizedOrder): boolean {
  return rulesOrderNeedsReview(order);
}

// True when the user corrected at least one field of this order in Review (#124); the correction is kept across syncs.
export function orderCorrectedByUser(order: NormalizedOrder): boolean {
  return (order.review?.correctedFields?.length ?? 0) > 0;
}

// Is this finding eligible for the headline owed total? Open or drafted ("claim
// sent") findings on orders that don't need review (AGENTS.md hard rule #7, #77).
export function findingCountsTowardOwed(
  finding: Finding,
  order: NormalizedOrder | undefined,
): boolean {
  return countsTowardOwed(finding, order);
}

export function computeOwedSummary(
  findings: Finding[],
  orders: NormalizedOrder[],
): OwedSummary {
  return computeOwed(findings, orders);
}

export function merchantName(order: NormalizedOrder | undefined): string {
  return order?.merchant.name ?? "Unknown merchant";
}
