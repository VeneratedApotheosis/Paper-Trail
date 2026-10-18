import {
  REVIEW_CONFIDENCE_THRESHOLD,
  type EmailClass,
  type Extraction,
  type Finding,
  type NormalizedOrder,
  type RedactedEmail,
} from "@/lib/contracts";
import { matchOrdersWithReasons } from "@/lib/orders/matcher";
import { mergeSameOrder } from "@/lib/orders/merge";
import { isExcludedMerchant, type PipelineEmailOutcome, type PipelineResult, type PipelineStats, type ReviewQueueItem } from "@/lib/pipeline/run";
import type { PriceFeed } from "@/lib/prices/feed";
import { defaultRules, runRulesIsolated } from "@/lib/rules";

/**
 * Pure ledger changes for user feedback (#117): add one email's extraction to a published pipeline result, or take
 * one email's contribution out. The store applies the same function to the live ledger and to the Gmail account's
 * stored result, so both stay consistent.
 */

export interface AddEmailContext {
  now: Date;
  priceFeed?: PriceFeed;
  excludedMerchants: ReadonlySet<string>;
  /** How the email was counted before (its counters are moved). */
  previous: { outcome: PipelineEmailOutcome; class?: EmailClass };
}

export interface AddEmailOutcome {
  result: PipelineResult;
  /** Order the email now belongs to; undefined when the matcher built none or the merchant is excluded. */
  orderId?: string;
  /** The email's order was not added because its merchant is excluded. */
  excluded: boolean;
}

function moveCounters(stats: PipelineStats, previous: AddEmailContext["previous"], next: EmailClass, extracted: boolean): PipelineStats {
  const classes = { ...stats.classes };
  if (previous.class) classes[previous.class] = Math.max(0, (classes[previous.class] ?? 0) - 1);
  classes[next] = (classes[next] ?? 0) + 1;
  return {
    ...stats,
    classes,
    prefilteredOut: stats.prefilteredOut - (previous.outcome === "prefiltered" ? 1 : 0),
    skipped: stats.skipped - (previous.outcome === "skipped" ? 1 : 0),
    extracted: stats.extracted + (extracted ? 1 : 0),
  };
}

function finalize(base: PipelineStats, orders: NormalizedOrder[], findings: Finding[], reviewQueue: ReviewQueueItem[]): PipelineResult {
  return { orders, findings, reviewQueue, stats: { ...base, orders: orders.length, findings: findings.length, needsReview: reviewQueue.length } };
}

/** Adds an email the classifier skipped, now extracted on the user's say-so, through the normal match + rules path. */
export function addExtractionToResult(result: PipelineResult, email: RedactedEmail, extraction: Extraction, context: AddEmailContext): AddEmailOutcome {
  const stats = moveCounters(result.stats, context.previous, extraction.class, true);
  stats.extractionOrigins = { ...stats.extractionOrigins, [extraction.cached ? "cache" : "llm"]: stats.extractionOrigins[extraction.cached ? "cache" : "llm"] + 1 };
  // The email's earlier review items (uncertain class, failed extraction) are superseded by this run.
  const reviewQueue = result.reviewQueue.filter((item) => item.emailId !== email.id || item.orderId !== undefined);
  if (extraction.confMin < REVIEW_CONFIDENCE_THRESHOLD) {
    reviewQueue.push({ emailId: email.id, stage: "extract", reason: `low extraction confidence ${extraction.confMin.toFixed(2)}` });
  }
  if (Number.isNaN(Date.parse(email.date))) {
    reviewQueue.push({ emailId: email.id, stage: "match", reason: "email has no readable date, so it can't be matched to an order" });
    return { result: finalize(stats, result.orders, result.findings, reviewQueue), excluded: false };
  }

  const matched = matchOrdersWithReasons([{ email, extraction }]);
  const built = matched.orders[0];
  if (!built) return { result: finalize(stats, result.orders, result.findings, reviewQueue), excluded: false };
  if (isExcludedMerchant(built, context.excludedMerchants)) {
    return { result: finalize(stats, result.orders, result.findings, reviewQueue), excluded: true };
  }

  const existing = result.orders.find((order) => order.id === built.id);
  let order = existing ? mergeSameOrder([existing, built]) : built;
  const rules = runRulesIsolated([order], defaultRules, { now: context.now, priceFeed: context.priceFeed });
  if (rules.failures.length > 0) order = { ...order, needsReview: true };
  const previousStatus = new Map(result.findings.map((finding) => [finding.id, finding.status]));
  const findings = [
    ...result.findings.filter((finding) => finding.orderId !== order.id),
    ...rules.findings.map((finding) => ({ ...finding, status: previousStatus.get(finding.id) ?? finding.status })),
  ];
  const orders = existing ? result.orders.map((candidate) => (candidate.id === order.id ? order : candidate)) : [...result.orders, order];
  const queue = reviewQueue.filter((item) => item.orderId !== order.id);
  if (rules.failures.length > 0) {
    queue.push({ emailId: email.id, stage: "rules", orderId: order.id,
      reason: `rules failed, no findings for this order: ${rules.failures[0].reason}`.slice(0, 200) });
  } else if (order.needsReview) {
    const reasons = matched.reviewReasons.get(built.id);
    queue.push({ emailId: order.messageIds[0], stage: "match", orderId: order.id,
      reason: reasons?.length ? `order needs review: ${reasons.join("; ")}`.slice(0, 200) : "order needs review: low confidence or missing confirmation" });
  }
  return { result: finalize(stats, orders, findings, queue), orderId: order.id, excluded: false };
}

export interface RemoveEmailOutcome {
  result: PipelineResult;
  /** Orders deleted because this email was their only message. */
  removedOrders: number;
  /** Orders that also hold other emails: left alone, since one email's share of a merged order can't be undone. */
  keptSharedOrders: number;
}

/** Takes an email the user says is not a receipt out of the ledger: its order (if it was the only message) and review items. */
export function removeEmailFromResult(result: PipelineResult, emailId: string, previous: { outcome: PipelineEmailOutcome; class?: EmailClass }): RemoveEmailOutcome {
  const touching = result.orders.filter((order) => order.messageIds.includes(emailId));
  const removable = new Set(touching.filter((order) => order.messageIds.length === 1).map((order) => order.id));
  const keptSharedOrders = touching.length - removable.size;
  if (keptSharedOrders > 0) return { result, removedOrders: 0, keptSharedOrders };

  const orders = result.orders.filter((order) => !removable.has(order.id));
  const findings = result.findings.filter((finding) => !removable.has(finding.orderId));
  const reviewQueue = result.reviewQueue.filter((item) => !(item.orderId && removable.has(item.orderId)) && !(item.emailId === emailId && !item.orderId));
  const classes = { ...result.stats.classes };
  if (previous.class) classes[previous.class] = Math.max(0, (classes[previous.class] ?? 0) - 1);
  classes.not_receipt = (classes.not_receipt ?? 0) + 1;
  const stats: PipelineStats = {
    ...result.stats,
    classes,
    extracted: result.stats.extracted - (previous.outcome === "extracted" ? 1 : 0),
    skipped: result.stats.skipped + 1,
  };
  return { result: finalize(stats, orders, findings, reviewQueue), removedOrders: removable.size, keptSharedOrders: 0 };
}
