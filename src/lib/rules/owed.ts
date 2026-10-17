import { REVIEW_CONFIDENCE_THRESHOLD, type Finding, type FindingStatus, type NormalizedOrder } from "@/lib/contracts";
import type { OwedSummary } from "@/lib/types";
import { sumMoneyBy } from "./money";

/**
 * The single source of truth for "You're owed $X" (issue #77, Option A). Pure: no clock, no store.
 *
 * - A finding counts toward the owed total while its status is `open` or `drafted` ("claim sent"): approving a claim
 *   does not mean the money came back. It drops out only when `resolved` (refund arrived) or `dismissed`.
 * - Findings on orders that need review are held in the excluded ("maybe") bucket instead (AGENTS.md hard rule 7).
 */

/** Statuses whose money is still outstanding. `drafted` = the user approved a claim but nothing came back yet. */
const OUTSTANDING_STATUSES: ReadonlySet<FindingStatus> = new Set(["open", "drafted"]);

/**
 * An order needs review when the matcher flagged it, or when its lowest extraction confidence is below the threshold
 * and no human has confirmed it yet (#47 sets `review.confirmedAt`).
 */
export function orderNeedsReview(order: NormalizedOrder): boolean {
  return order.needsReview || (order.confMin < REVIEW_CONFIDENCE_THRESHOLD && !order.review?.confirmedAt);
}

/** Open or drafted: the money is still owed to the user, whatever the order's review state. */
export function isOutstandingFinding(finding: Finding): boolean {
  return OUTSTANDING_STATUSES.has(finding.status);
}

/** Does this finding count toward the headline owed total? Needs an existing order that doesn't need review. */
export function countsTowardOwed(finding: Finding, order: NormalizedOrder | undefined): boolean {
  return isOutstandingFinding(finding) && order !== undefined && !orderNeedsReview(order);
}

/**
 * Owed summary over findings and their orders. Every total is rounded to cents.
 * `claimSentCount` / `claimSentTotal` are the drafted subset of `findingCount` / `owedTotal`;
 * `excludedCount` / `excludedTotal` are outstanding findings held out because their order needs review (or is missing).
 */
export function computeOwed(findings: readonly Finding[], orders: readonly NormalizedOrder[]): Required<OwedSummary> {
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const included: Finding[] = [];
  const excluded: Finding[] = [];
  for (const finding of findings) {
    if (!isOutstandingFinding(finding)) continue;
    if (countsTowardOwed(finding, ordersById.get(finding.orderId))) included.push(finding);
    else excluded.push(finding);
  }
  const claimSent = included.filter((finding) => finding.status === "drafted");
  const amount = (finding: Finding) => finding.amountAtStake;
  return {
    // Known follow-up: totals add amounts across currencies and label them with the first included finding's
    // currency. Fine while every ledger is single-currency (the seed is USD); mixed currencies need per-currency totals.
    currency: included[0]?.currency ?? "USD",
    owedTotal: sumMoneyBy(included, amount),
    findingCount: included.length,
    claimSentCount: claimSent.length,
    claimSentTotal: sumMoneyBy(claimSent, amount),
    excludedCount: excluded.length,
    excludedTotal: sumMoneyBy(excluded, amount),
  };
}
