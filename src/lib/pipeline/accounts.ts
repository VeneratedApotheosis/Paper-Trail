import type { Finding, NormalizedOrder } from "@/lib/contracts";
import { mergeSameOrder } from "@/lib/orders/merge";
import { defaultRules, runRulesIsolated } from "@/lib/rules";
import type { PipelineResult, PipelineStats, ReviewQueueItem } from "./run";

/**
 * One linked Gmail account's last published sync (#114). The store keeps one per account and rebuilds the merged
 * ledger from all of them, so syncing account A never drops orders that only account B's inbox produced.
 */
export interface AccountPipelineResult {
  accountId: string;
  asOf: string;
  result: PipelineResult;
}

export interface MergedAccountResults {
  asOf: string;
  result: PipelineResult;
}

/**
 * Merges per-account pipeline results into one ledger result. Pure and deterministic (accounts are processed in id
 * order). Orders from different inboxes with the same id (same merchant + order ref) become one order with every
 * source (see mergeSameOrder) and are never counted twice; rules run again only for those merged orders, all other
 * findings are kept as the account's pipeline produced them. `now` is the rule clock for the merged orders.
 * Orders without `sources` are stamped with their account id.
 */
export function mergeAccountResults(accounts: readonly AccountPipelineResult[], now: Date): MergedAccountResults {
  const ordered = [...accounts].sort((a, b) => a.accountId.localeCompare(b.accountId));
  if (ordered.length === 1) {
    // One inbox: the pipeline result is already the ledger, only tag the sources.
    const [{ accountId, asOf, result }] = ordered;
    return { asOf, result: { ...result, orders: result.orders.map((order) => stampSource(order, accountId)) } };
  }
  const copies = new Map<string, NormalizedOrder[]>();
  for (const { accountId, result } of ordered) {
    for (const order of result.orders) {
      copies.set(order.id, [...(copies.get(order.id) ?? []), stampSource(order, accountId)]);
    }
  }
  const mergedIds = new Set([...copies].filter(([, group]) => group.length > 1).map(([id]) => id));
  const orders = [...copies.values()].map((group) => (group.length > 1 ? mergeSameOrder(group) : group[0]));

  const rules = runRulesIsolated(orders.filter((order) => mergedIds.has(order.id)), defaultRules, { now });
  const failed = new Set(rules.failures.map((failure) => failure.orderId));
  const finalOrders = orders
    .map((order) => (failed.has(order.id) ? { ...order, needsReview: true } : order))
    .sort((a, b) => a.placedAt.localeCompare(b.placedAt) || a.id.localeCompare(b.id));

  const findings = dedupe(
    [...ordered.flatMap(({ result }) => result.findings).filter((finding) => !mergedIds.has(finding.orderId)), ...rules.findings],
    (finding: Finding) => finding.id,
  );

  const mergedReasons = new Map<string, string>();
  const kept: ReviewQueueItem[] = [];
  for (const item of ordered.flatMap(({ result }) => result.reviewQueue)) {
    if (item.orderId && mergedIds.has(item.orderId)) {
      if (item.stage === "match" && !mergedReasons.has(item.orderId)) mergedReasons.set(item.orderId, item.reason);
    } else kept.push(item);
  }
  for (const order of finalOrders.filter((candidate) => mergedIds.has(candidate.id) && candidate.needsReview)) {
    kept.push({
      emailId: order.messageIds[0], stage: "match", orderId: order.id,
      reason: mergedReasons.get(order.id) ?? "order needs review: merged from several inboxes with low confidence",
    });
  }
  for (const failure of rules.failures) {
    const order = finalOrders.find((candidate) => candidate.id === failure.orderId);
    kept.push({ emailId: order?.messageIds[0] ?? failure.orderId, stage: "rules", orderId: failure.orderId,
      reason: `rules failed, no findings for this order: ${failure.reason}`.slice(0, 200) });
  }
  const reviewQueue = dedupe(kept, (item) => `${item.emailId}|${item.stage}|${item.orderId ?? ""}|${item.reason}`);

  const asOf = ordered.map((account) => account.asOf).sort().at(-1) ?? now.toISOString();
  return {
    asOf,
    result: {
      orders: finalOrders, findings, reviewQueue,
      stats: sumStats(ordered.map(({ result }) => result.stats), { orders: finalOrders.length,
        findings: findings.length, needsReview: reviewQueue.length }),
    },
  };
}

function stampSource(order: NormalizedOrder, accountId: string): NormalizedOrder {
  return order.sources?.length ? order : { ...order, sources: [accountId] };
}

function dedupe<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Per-email counters add up across accounts; the order-level counters are the merged ledger's own. */
function sumStats(all: readonly PipelineStats[], merged: Pick<PipelineStats, "orders" | "findings" | "needsReview">): PipelineStats {
  const stats: PipelineStats = {
    emails: 0, prefilteredOut: 0, classes: {}, extracted: 0, skipped: 0,
    extractionOrigins: { llm: 0, cache: 0, gold: 0 }, excludedOrders: 0, ...merged,
  };
  for (const part of all) {
    stats.emails += part.emails;
    stats.prefilteredOut += part.prefilteredOut;
    stats.extracted += part.extracted;
    stats.skipped += part.skipped;
    stats.excludedOrders += part.excludedOrders;
    for (const kind of ["llm", "cache", "gold"] as const) stats.extractionOrigins[kind] += part.extractionOrigins[kind];
    for (const [name, count] of Object.entries(part.classes) as Array<[keyof PipelineStats["classes"], number]>) {
      stats.classes[name] = (stats.classes[name] ?? 0) + count;
    }
  }
  return stats;
}
