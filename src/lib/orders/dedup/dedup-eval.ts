import type { EmailClass, NormalizedOrder } from "@/lib/contracts";
import { mergeAccountResults } from "@/lib/pipeline/accounts";
import { runPipeline, type PipelineExtractor, type PipelineResult } from "@/lib/pipeline/run";
import { matchOrdersWithReasons, type MatchInput } from "@/lib/orders/matcher";
import { DEDUP_SPECS, extractionOf, rawEmailOf, type DedupSpec } from "./dedup-fixtures";

/**
 * Pairwise precision / recall of "these two emails are the same purchase" over the labelled dedup set (#126).
 * `before` is the pre-#126 behaviour (legacy grouping per inbox, inboxes joined only by identical order id);
 * `after` runs the real pipeline per inbox (exact-copy collapse, scored matching) and the real account merge.
 */

const NOW = new Date("2026-11-01T00:00:00Z");

export interface PairwiseScore {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  /** Pairs wrongly merged / wrongly kept apart, as `idA + idB`. */
  wronglyMerged: string[];
  wronglySplit: string[];
}

export interface DedupRun {
  /** Email id -> order id. */
  orderOf: Map<string, string>;
  orders: NormalizedOrder[];
  /** Emails that reached the extractor (LLM calls a real run would make). */
  extractorCalls: number;
}

function byAccount(specs: readonly DedupSpec[]): Map<string, DedupSpec[]> {
  const groups = new Map<string, DedupSpec[]>();
  for (const spec of specs) groups.set(spec.account ?? "default", [...(groups.get(spec.account ?? "default") ?? []), spec]);
  return groups;
}

function orderMap(orders: readonly NormalizedOrder[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const order of orders) for (const id of order.messageIds) map.set(id, order.id);
  return map;
}

/** Pre-#126 behaviour: legacy grouping inside each inbox, then orders with the same id join. */
export function runBefore(specs: readonly DedupSpec[]): DedupRun {
  const orders = new Map<string, NormalizedOrder>();
  for (const [, group] of byAccount(specs)) {
    const inputs: MatchInput[] = group.map((spec) => ({ email: rawEmailOf(spec), extraction: extractionOf(spec) }));
    for (const order of matchOrdersWithReasons(inputs, { legacyGrouping: true }).orders) {
      const known = orders.get(order.id);
      orders.set(order.id, known ? { ...known, messageIds: [...new Set([...known.messageIds, ...order.messageIds])] } : order);
    }
  }
  return { orderOf: orderMap([...orders.values()]), orders: [...orders.values()], extractorCalls: specs.length };
}

/** The real thing: pipeline per inbox (copies collapsed before extraction), then the account merge. */
export async function runAfter(specs: readonly DedupSpec[]): Promise<DedupRun> {
  const bySpec = new Map(specs.map((spec) => [spec.id, spec]));
  let extractorCalls = 0;
  const extractor: PipelineExtractor = async (_redacted, _classification, raw) => {
    extractorCalls += 1;
    return { ok: true, extraction: extractionOf(bySpec.get(raw.id)!) };
  };
  const results: Array<{ accountId: string; asOf: string; result: PipelineResult }> = [];
  for (const [accountId, group] of byAccount(specs)) {
    const result = await runPipeline(group.map(rawEmailOf), {
      now: NOW,
      extractor,
      redaction: "off",
      classOverride: (id) => (bySpec.get(id)?.cls ?? "order") as EmailClass,
    });
    results.push({ accountId, asOf: NOW.toISOString(), result });
  }
  const merged = mergeAccountResults(results, NOW).result;
  return { orderOf: orderMap(merged.orders), orders: merged.orders, extractorCalls };
}

/** Pairwise score of a run against the labels (`purchase`) of the specs. */
export function pairwiseScore(specs: readonly DedupSpec[], run: DedupRun): PairwiseScore {
  let truePositives = 0;
  const wronglyMerged: string[] = [];
  const wronglySplit: string[] = [];
  for (let i = 0; i < specs.length; i += 1) {
    for (let j = i + 1; j < specs.length; j += 1) {
      const same = specs[i].purchase === specs[j].purchase;
      const merged = run.orderOf.get(specs[i].id) === run.orderOf.get(specs[j].id);
      if (same && merged) truePositives += 1;
      else if (!same && merged) wronglyMerged.push(`${specs[i].id} + ${specs[j].id}`);
      else if (same && !merged) wronglySplit.push(`${specs[i].id} + ${specs[j].id}`);
    }
  }
  const falsePositives = wronglyMerged.length;
  const falseNegatives = wronglySplit.length;
  return {
    truePositives, falsePositives, falseNegatives,
    precision: truePositives + falsePositives === 0 ? 1 : truePositives / (truePositives + falsePositives),
    recall: truePositives + falseNegatives === 0 ? 1 : truePositives / (truePositives + falseNegatives),
    wronglyMerged, wronglySplit,
  };
}

export function scenarios(specs: readonly DedupSpec[] = DEDUP_SPECS): Map<string, DedupSpec[]> {
  const groups = new Map<string, DedupSpec[]>();
  for (const spec of specs) groups.set(spec.scenario, [...(groups.get(spec.scenario) ?? []), spec]);
  return groups;
}
