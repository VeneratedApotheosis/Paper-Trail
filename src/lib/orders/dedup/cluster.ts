import { AMBIGUITY_MARGIN, POSSIBLE_DUPLICATE_SCORE, scorePair, type DedupCandidate, type MergeReason, type PairScore } from "./score";

/**
 * Clusters candidates (emails or orders) into purchases (#126). Deterministic for a given candidate order.
 *
 * 1. Pairs that name the same email or the same order reference merge (strongest evidence first), unless merging would
 *    put two order confirmations in one cluster that a hard constraint forbids: a summary email listing two order
 *    numbers cannot chain two orders together.
 * 2. A lifecycle email (shipped, delivered, return, refund, ...) still without a confirmation attaches to the one order
 *    its score clearly prefers (items + amount + timing, inside the lifecycle window). A tie, or a score in the middle
 *    band, leaves it alone and records a possible duplicate instead.
 * 3. Middle-band pairs that ended up in different clusters are reported as possible duplicates.
 */

export interface ClusterMerge {
  /** Candidate indexes of the pair whose evidence joined two clusters. */
  a: number;
  b: number;
  reason: MergeReason;
}

export interface PossibleDuplicate {
  /** The later candidate of the pair. */
  node: number;
  /** The earlier candidate it may duplicate. */
  other: number;
  score: number;
  reasons: string[];
}

export interface ClusterResult {
  /** Candidate indexes per cluster, each ascending; clusters ordered by their first member. */
  clusters: number[][];
  merges: ClusterMerge[];
  possibleDuplicates: PossibleDuplicate[];
  /** Warnings about a lifecycle candidate that merged anyway (e.g. refund above the order total). */
  warnings: Map<number, string[]>;
}

/** Evidence that merges any two candidates, strongest first. `items_amount` here is two confirmations, one without a number. */
const STAGE_ONE_REASONS: readonly MergeReason[] = ["message_id", "fingerprint", "shared_ref", "items_amount"];

export interface ClusterOptions {
  /** Veto on joining two candidates (e.g. only orders from different inboxes are merged across accounts). */
  allowPair?: (a: number, b: number) => boolean;
}

export function clusterCandidates(candidates: readonly DedupCandidate[], options: ClusterOptions = {}): ClusterResult {
  const count = candidates.length;
  const parent = Array.from({ length: count }, (_, index) => index);
  const members = new Map<number, number[]>(candidates.map((_, index) => [index, [index]]));
  const merges: ClusterMerge[] = [];
  const warnings = new Map<number, string[]>();

  const scores = new Map<number, PairScore>();
  const score = (a: number, b: number): PairScore => {
    const [low, high] = a < b ? [a, b] : [b, a];
    const key = low * count + high;
    let cached = scores.get(key);
    if (!cached) {
      cached = scorePair(candidates[low], candidates[high]);
      scores.set(key, cached);
    }
    return cached;
  };
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    return root;
  };

  // Only candidates sharing a merchant key can score; bucket by key so large runs stay cheap.
  const byMerchantKey = new Map<string, number[]>();
  candidates.forEach((candidate, index) => {
    for (const key of candidate.merchantKeys) byMerchantKey.set(key, [...(byMerchantKey.get(key) ?? []), index]);
  });
  const pairKeys = new Set<number>();
  for (const bucket of byMerchantKey.values()) {
    for (let x = 0; x < bucket.length; x += 1) for (let y = x + 1; y < bucket.length; y += 1) pairKeys.add(bucket[x] * count + bucket[y]);
  }
  const pairs = [...pairKeys].sort((p, q) => p - q).map((key) => [Math.floor(key / count), key % count] as const);

  function conflicts(rootA: number, rootB: number): boolean {
    for (const x of members.get(rootA) ?? []) {
      if (candidates[x].kind !== "confirmation") continue;
      for (const y of members.get(rootB) ?? []) {
        if (candidates[y].kind === "confirmation" && score(x, y).blocked !== null) return true;
      }
    }
    return false;
  }

  function union(a: number, b: number, reason: MergeReason): boolean {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return true;
    if (conflicts(rootA, rootB)) return false;
    const [keep, drop] = rootA < rootB ? [rootA, rootB] : [rootB, rootA];
    parent[drop] = keep;
    members.set(keep, [...(members.get(keep) ?? []), ...(members.get(drop) ?? [])]);
    members.delete(drop);
    merges.push({ a, b, reason });
    return true;
  }

  const stageOne = pairs
    .map(([a, b]) => ({ a, b, pair: score(a, b) }))
    .filter(({ a, b }) => options.allowPair?.(a, b) ?? true)
    .filter(({ a, b, pair }) => pair.decision === "merge" && pair.mergeReason !== null && STAGE_ONE_REASONS.includes(pair.mergeReason) && (pair.mergeReason !== "items_amount" || (candidates[a].kind === "confirmation" && candidates[b].kind === "confirmation")))
    .sort((p, q) => STAGE_ONE_REASONS.indexOf(p.pair.mergeReason!) - STAGE_ONE_REASONS.indexOf(q.pair.mergeReason!) || p.a - q.a || p.b - q.b);
  for (const { a, b, pair } of stageOne) {
    if (!union(a, b, pair.mergeReason!) || !pair.warning) continue;
    const lifecycle = candidates[a].kind === "lifecycle" ? a : b;
    warnings.set(lifecycle, [...(warnings.get(lifecycle) ?? []), pair.warning]);
  }

  const hasConfirmation = (root: number) => (members.get(root) ?? []).some((index) => candidates[index].kind === "confirmation");
  const ambiguous: PossibleDuplicate[] = [];
  for (let node = 0; node < count; node += 1) {
    if (candidates[node].kind !== "lifecycle") continue;
    const root = find(node);
    if (hasConfirmation(root) || (members.get(root)?.length ?? 0) > 1) continue;
    const bestByCluster = new Map<number, { index: number; pair: PairScore }>();
    for (const other of members.keys()) {
      if (other === root || !hasConfirmation(other)) continue;
      for (const index of members.get(other) ?? []) {
        if (candidates[index].kind !== "confirmation") continue;
        const pair = score(node, index);
        if (pair.blocked !== null || pair.decision === "none") continue;
        const current = bestByCluster.get(other);
        if (!current || pair.score > current.pair.score) bestByCluster.set(other, { index, pair });
      }
    }
    // A bare lifecycle email (no reference, items or amount to contradict) joins the merchant's only order in its window.
    const bare = candidates[node].refs.length === 0 && candidates[node].items.length === 0 && candidates[node].amount === null;
    if (bare) {
      const open = [...members.keys()].filter((other) => other !== root && hasConfirmation(other) && (members.get(other) ?? []).some((index) => candidates[index].kind === "confirmation" && score(node, index).blocked === null));
      if (open.length === 1) {
        const target = (members.get(open[0]) ?? []).find((index) => candidates[index].kind === "confirmation" && score(node, index).blocked === null)!;
        if (union(node, target, "only_order")) continue;
      }
    }
    const ranked = [...bestByCluster.values()].sort((p, q) => q.pair.score - p.pair.score || p.index - q.index);
    const [best, second] = ranked;
    if (!best) continue;
    const clear = !second || best.pair.score - second.pair.score >= AMBIGUITY_MARGIN;
    if (best.pair.decision === "merge" && clear && best.pair.mergeReason) {
      union(node, best.index, best.pair.mergeReason);
    } else if (best.pair.score >= POSSIBLE_DUPLICATE_SCORE) {
      const reasons = [...best.pair.reasons, ...(second && !clear ? ["matches another order about as well"] : [])];
      ambiguous.push({ node, other: best.index, score: best.pair.score, reasons });
    }
  }

  const possible = new Map<number, PossibleDuplicate>();
  const consider = (item: PossibleDuplicate) => {
    const root = find(item.node);
    if (root === find(item.other)) return;
    const current = possible.get(item.node);
    if (!current || item.score > current.score) possible.set(item.node, item);
  };
  ambiguous.forEach(consider);
  for (const [a, b] of pairs) {
    if (options.allowPair && !options.allowPair(a, b)) continue;
    const pair = score(a, b);
    if (pair.decision === "possible" && pair.blocked === null && candidates[a].kind === "confirmation" && candidates[b].kind === "confirmation") {
      consider({ node: b, other: a, score: pair.score, reasons: pair.reasons });
    }
  }

  const clusters = [...members.values()].map((list) => [...list].sort((p, q) => p - q)).sort((p, q) => p[0] - q[0]);
  return { clusters, merges, possibleDuplicates: [...possible.values()].sort((p, q) => p.node - q.node), warnings };
}
