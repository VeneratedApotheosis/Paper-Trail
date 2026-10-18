import type { Finding, NormalizedOrder } from "@/lib/contracts";
import { clusterCandidates } from "@/lib/orders/dedup/cluster";
import { merchantKeys } from "@/lib/orders/dedup/merchant";
import { canonicalRef, canonicalRefs } from "@/lib/orders/dedup/refs";
import type { DedupCandidate, MergeReason } from "@/lib/orders/dedup/score";
import { slugify } from "@/lib/orders/matcher";
import { mergeSameOrder } from "@/lib/orders/merge";
import { defaultRules, runRulesIsolated } from "@/lib/rules";
import type { PipelineDedupStats, PipelineResult, PipelineStats, ReviewQueueItem } from "./run";

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
 * order). Orders from different inboxes become one order with every source (see mergeSameOrder) and are never counted
 * twice when they have the same id (same merchant + order ref) or the dedup scorer says they are the same purchase
 * (#126: merchant identity + canonical or shared references, or a shared Message-ID / body fingerprint); middle-band
 * pairs get `possibleDuplicateOf`. Rules run again only for merged orders, all other findings are kept as the account's
 * pipeline produced them. `now` is the rule clock for the merged orders. Orders without `sources` are stamped with
 * their account id.
 */
export function mergeAccountResults(accounts: readonly AccountPipelineResult[], now: Date): MergedAccountResults {
  const ordered = [...accounts].sort((a, b) => a.accountId.localeCompare(b.accountId));
  if (ordered.length === 1) {
    // One inbox: the pipeline result is already the ledger, only tag the sources.
    const [{ accountId, asOf, result }] = ordered;
    return { asOf, result: { ...result, orders: result.orders.map((order) => stampSource(order, accountId)) } };
  }
  const stamped = ordered
    .flatMap(({ accountId, result }) => result.orders.map((order) => stampSource(order, accountId)))
    .sort((a, b) => a.placedAt.localeCompare(b.placedAt) || a.id.localeCompare(b.id) || (a.sources ?? []).join().localeCompare((b.sources ?? []).join()));

  // One purchase can show up as the same order id in two inboxes, under another spelling of the merchant or order
  // number, or as the same email. Only orders from disjoint sets of inboxes are joined: one inbox's pipeline already
  // decided its own orders. Recurring charges with one reference stay separate (hard constraint in the scorer).
  const clustering = clusterCandidates(stamped.map(orderCandidate), {
    allowPair: (a, b) => !(stamped[a].sources ?? []).some((source) => (stamped[b].sources ?? []).includes(source)),
  });
  const crossMerges: Partial<Record<MergeReason, number>> = {};
  for (const merge of clustering.merges) crossMerges[merge.reason] = (crossMerges[merge.reason] ?? 0) + 1;

  // Final ids are unique: a later cluster that would reuse an id (a recurring charge present in both inboxes) gets a suffix.
  const usedIds = new Map<string, number>();
  const clusterOrders = clustering.clusters.map((cluster) => {
    const members = cluster.map((index) => stamped[index]);
    const merged = cluster.length > 1 ? mergeSameOrder(members) : members[0];
    const seen = (usedIds.get(merged.id) ?? 0) + 1;
    usedIds.set(merged.id, seen);
    return { members, order: seen === 1 ? merged : { ...merged, id: `${merged.id}:${seen}`, aliasIds: [...new Set([...(merged.aliasIds ?? []), merged.id])] } };
  });
  const orders = clusterOrders.map(({ order }) => order);
  const idToFinal = new Map<string, string>();
  clusterOrders.forEach(({ members, order }) => members.forEach((member) => idToFinal.set(member.id, order.id)));

  // Clusters whose orders changed id or were merged get fresh rules; so does any cluster sharing an id with them.
  const touched = new Set<number>();
  const mergedIds = new Set<string>();
  const markTouched = (index: number) => {
    touched.add(index);
    for (const member of clusterOrders[index].members) mergedIds.add(member.id);
    mergedIds.add(clusterOrders[index].order.id);
  };
  clusterOrders.forEach(({ members, order }, index) => {
    if (members.length > 1 || members[0].id !== order.id) markTouched(index);
  });
  for (let changed = true; changed; ) {
    changed = false;
    clusterOrders.forEach(({ members, order }, index) => {
      if (!touched.has(index) && (mergedIds.has(order.id) || members.some((member) => mergedIds.has(member.id)))) {
        markTouched(index);
        changed = true;
      }
    });
  }
  const touchedIds = new Set([...touched].map((index) => orders[index].id));
  const flagged = new Map<string, NonNullable<NormalizedOrder["possibleDuplicateOf"]>>();
  for (const possible of clustering.possibleDuplicates) {
    const from = clustering.clusters.findIndex((cluster) => cluster.includes(possible.node));
    const to = clustering.clusters.findIndex((cluster) => cluster.includes(possible.other));
    const [later, earlier] = clustering.clusters[from][0] >= clustering.clusters[to][0] ? [from, to] : [to, from];
    const current = flagged.get(orders[later].id);
    if (!current || current.score < possible.score) {
      flagged.set(orders[later].id, { orderId: orders[earlier].id, reason: possible.reasons.join(", "), score: possible.score });
    }
  }
  const flaggedOrders: NormalizedOrder[] = orders.map((order) => {
    const own = order.possibleDuplicateOf ? { ...order.possibleDuplicateOf, orderId: idToFinal.get(order.possibleDuplicateOf.orderId) ?? order.possibleDuplicateOf.orderId } : undefined;
    const next = flagged.get(order.id) ?? (own && own.orderId !== order.id ? own : undefined);
    if (next === order.possibleDuplicateOf) return order;
    const rest: NormalizedOrder = { ...order };
    delete rest.possibleDuplicateOf;
    return next ? { ...rest, possibleDuplicateOf: next } : rest;
  });

  const rules = runRulesIsolated(flaggedOrders.filter((order) => touchedIds.has(order.id)), defaultRules, { now });
  const failed = new Set(rules.failures.map((failure) => failure.orderId));
  const finalOrders = flaggedOrders
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
      const finalId = idToFinal.get(item.orderId) ?? item.orderId;
      if (item.stage === "match" && !mergedReasons.has(finalId)) mergedReasons.set(finalId, item.reason);
    } else kept.push(item);
  }
  for (const order of finalOrders.filter((candidate) => touchedIds.has(candidate.id) && candidate.needsReview)) {
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
        findings: findings.length, needsReview: reviewQueue.length }, crossMerges,
        finalOrders.filter((order) => order.possibleDuplicateOf).length),
    },
  };
}

/** An order as a dedup candidate: merchant identity from name and domain, canonical order ref, email keys. */
function orderCandidate(order: NormalizedOrder): DedupCandidate {
  const keys = merchantKeys({
    from: order.merchant.domain ? `shop@${order.merchant.domain}` : "", subject: "", merchant: order.merchant.name, merchantDomain: order.merchant.domain,
  });
  return {
    merchantKeys: keys.length > 0 ? keys : ["unknown"],
    refs: canonicalRefs(order.orderRef, []),
    primaryRef: canonicalRef(order.orderRef),
    kind: "confirmation",
    emailClass: "order",
    currency: order.currency,
    amount: order.total,
    at: Date.parse(order.placedAt),
    items: order.lineItems.map((item) => ({ key: slugify(item.name), sku: item.sku ?? null, unitPrice: item.unitPrice, qty: item.qty })),
    exactKeys: order.emailKeys ?? [],
    threadKey: null,
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
function sumStats(
  all: readonly PipelineStats[],
  merged: Pick<PipelineStats, "orders" | "findings" | "needsReview">,
  crossMerges: PipelineDedupStats["merges"],
  possibleDuplicates: number,
): PipelineStats {
  const stats: PipelineStats = {
    emails: 0, prefilteredOut: 0, classes: {}, extracted: 0, skipped: 0,
    extractionOrigins: { llm: 0, cache: 0, gold: 0 }, excludedOrders: 0, ...merged,
  };
  const dedup: PipelineDedupStats = { emailsCollapsed: 0, merges: { ...crossMerges }, possibleDuplicates };
  for (const part of all) {
    stats.emails += part.emails;
    stats.prefilteredOut += part.prefilteredOut;
    stats.extracted += part.extracted;
    stats.skipped += part.skipped;
    stats.excludedOrders += part.excludedOrders;
    dedup.emailsCollapsed += part.dedup?.emailsCollapsed ?? 0;
    for (const [reason, merges] of Object.entries(part.dedup?.merges ?? {}) as Array<[MergeReason, number]>) dedup.merges[reason] = (dedup.merges[reason] ?? 0) + merges;
    for (const kind of ["llm", "cache", "gold"] as const) stats.extractionOrigins[kind] += part.extractionOrigins[kind];
    for (const [name, count] of Object.entries(part.classes) as Array<[keyof PipelineStats["classes"], number]>) {
      stats.classes[name] = (stats.classes[name] ?? 0) + count;
    }
  }
  return { ...stats, dedup };
}
