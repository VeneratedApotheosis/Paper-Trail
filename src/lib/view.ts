// Display-only helpers that derive UI fields from the canonical contracts.
// NormalizedOrder has no "status" field — status is derived from its events.
import type { Finding, NormalizedOrder, OrderEvent } from "@/lib/contracts";
import { CONFIDENCE_THRESHOLD } from "@/lib/format";
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
  shipped: "shipped",
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
  return order.needsReview || (order.confMin < CONFIDENCE_THRESHOLD && !order.review?.confirmedAt);
}

// Is this finding eligible for the headline owed total? Excludes needs-review
// orders and dismissed/resolved findings (AGENTS.md hard rule #7).
export function findingCountsTowardOwed(
  finding: Finding,
  order: NormalizedOrder | undefined,
): boolean {
  return (
    finding.status === "open" &&
    order !== undefined &&
    !orderNeedsReview(order)
  );
}

export function computeOwedSummary(
  findings: Finding[],
  orders: NormalizedOrder[],
): OwedSummary {
  const byId = new Map(orders.map((o) => [o.id, o]));
  const included = findings.filter((f) => findingCountsTowardOwed(f, byId.get(f.orderId)));
  const excluded = findings.filter((f) => !included.includes(f) && f.status === "open");
  return {
    currency: included[0]?.currency ?? "USD",
    owedTotal: included.reduce((sum, f) => sum + f.amountAtStake, 0),
    findingCount: included.length,
    excludedCount: excluded.length,
    excludedTotal: excluded.reduce((sum, f) => sum + f.amountAtStake, 0),
  };
}

export function merchantName(order: NormalizedOrder | undefined): string {
  return order?.merchant.name ?? "Unknown merchant";
}
