import {
  REVIEW_CONFIDENCE_THRESHOLD,
  type Classification,
  type EmailClass,
  type Finding,
  type NormalizedOrder,
  type RawEmail,
  type RedactedEmail,
} from "@/lib/contracts";
import { SKIPPED_EXTRACTION_CLASSES, classify, isReceiptLike, redact, type ExtractResult } from "@/lib/ingestion";
import { matchOrdersWithReasons, type MatchInput } from "@/lib/orders/matcher";
import type { PriceFeed } from "@/lib/prices/feed";
import { defaultRules, runRulesIsolated } from "@/lib/rules";
import type { AuditEntry } from "@/lib/types";

/**
 * Pipeline runner (issue #4): every input source (Gmail sync, seed demo, .eml/.mbox upload) goes through this one
 * code path: [prefilter] -> classify (raw) -> redact -> extract (redacted) -> matchOrders -> runRules.
 * Nothing low-confidence or failed is dropped silently: it lands in `reviewQueue` with a reason. One bad email or
 * order never aborts the run: extraction failures and per-order rule failures are isolated to that email/order.
 */

/** Audit row without the store-assigned id. Details carry ids, classes, models and counts only, never email text. */
export type PipelineAuditEvent = Omit<AuditEntry, "id">;

/** Extracts fields from one redacted email. `raw` is for lookups by id only and must never reach an LLM. */
export type PipelineExtractor = (
  redacted: RedactedEmail,
  classification: Classification,
  raw: RawEmail,
) => Promise<ExtractResult>;

export interface PipelineDeps {
  /** Rule clock (seed asOf for demo mode). */
  now: Date;
  priceFeed?: PriceFeed;
  extractor: PipelineExtractor;
  audit?: (event: PipelineAuditEvent) => void;
  /** Normalized merchant keys (see normalizeMerchantKey); matching orders are dropped before rules run. */
  excludedMerchants?: ReadonlySet<string>;
  /** Run isReceiptLike() first. Only for inputs that skipped the Gmail search query (demo, uploads). */
  applyPrefilter?: boolean;
  /** Short source name used in audit details, e.g. "demo" or "upload". */
  sourceLabel?: string;
  /** Wall clock for audit timestamps; defaults to the system clock. */
  auditClock?: () => Date;
}

export type ReviewStage = "classify" | "extract" | "match" | "rules";

export interface ReviewQueueItem {
  emailId: string;
  stage: ReviewStage;
  reason: string;
  /** Set for match- and rules-stage items (orders that need review). */
  orderId?: string;
}

export interface PipelineStats {
  emails: number;
  /** Dropped by isReceiptLike() (only when applyPrefilter is set). */
  prefilteredOut: number;
  classes: Partial<Record<EmailClass, number>>;
  extracted: number;
  /** Not extracted: marketing / not_receipt (incl. phishing look-alikes) or skipped by the extractor. */
  skipped: number;
  /** Successful extractions by origin. `gold` = precomputed from seed gold labels, not LLM output. */
  extractionOrigins: { llm: number; cache: number; gold: number };
  orders: number;
  excludedOrders: number;
  findings: number;
  needsReview: number;
}

export interface PipelineResult {
  orders: NormalizedOrder[];
  findings: Finding[];
  reviewQueue: ReviewQueueItem[];
  stats: PipelineStats;
}

/** Model name extractionFromGoldLabel() stamps on precomputed (non-LLM) extractions. */
export const GOLD_EXTRACTION_MODEL = "gold";

const MAX_REASON_CHARS = 200;

/** Merchant exclusion key: trimmed, lowercased display name or domain. */
export function normalizeMerchantKey(merchant: string): string {
  return merchant.trim().toLowerCase();
}

/** True when the order's merchant name or domain is in the excluded set. */
export function isExcludedMerchant(order: NormalizedOrder, excluded: ReadonlySet<string>): boolean {
  if (excluded.size === 0) return false;
  const keys = [order.merchant.name, order.merchant.domain].filter((key): key is string => Boolean(key));
  return keys.some((key) => excluded.has(normalizeMerchantKey(key)));
}

function clip(text: string): string {
  return text.length <= MAX_REASON_CHARS ? text : `${text.slice(0, MAX_REASON_CHARS - 1)}…`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
}

function orderReviewReason(order: NormalizedOrder, matcherReasons: readonly string[] | undefined): string {
  if (matcherReasons && matcherReasons.length > 0) return clip(`order needs review: ${matcherReasons.join("; ")}`);
  if (order.confMin < REVIEW_CONFIDENCE_THRESHOLD) {
    return `order needs review: lowest extraction confidence ${order.confMin.toFixed(2)}`;
  }
  return "order needs review: no order confirmation or currency found";
}

export async function runPipeline(emails: readonly RawEmail[], deps: PipelineDeps): Promise<PipelineResult> {
  const auditClock = deps.auditClock ?? (() => new Date());
  const audit = (event: Omit<PipelineAuditEvent, "at">) => deps.audit?.({ at: auditClock().toISOString(), ...event });
  const source = deps.sourceLabel ?? "pipeline";
  const excluded = deps.excludedMerchants ?? new Set<string>();

  const reviewQueue: ReviewQueueItem[] = [];
  const stats: PipelineStats = {
    emails: emails.length,
    prefilteredOut: 0,
    classes: {},
    extracted: 0,
    skipped: 0,
    extractionOrigins: { llm: 0, cache: 0, gold: 0 },
    orders: 0,
    excludedOrders: 0,
    findings: 0,
    needsReview: 0,
  };
  audit({ type: "sync_start", detail: `Pipeline started (${source}): ${emails.length} emails` });

  const matchInputs: MatchInput[] = [];
  for (const raw of emails) {
    if (deps.applyPrefilter && !isReceiptLike(raw).keep) {
      stats.prefilteredOut += 1;
      continue;
    }

    // Classify the raw email: redaction tokenizes addresses, which hides look-alike sender domains in forwards.
    const classification = classify(raw);
    stats.classes[classification.class] = (stats.classes[classification.class] ?? 0) + 1;
    const redacted = redact(raw);

    if (SKIPPED_EXTRACTION_CLASSES.has(classification.class)) {
      stats.skipped += 1;
      if (classification.confidence < REVIEW_CONFIDENCE_THRESHOLD) {
        reviewQueue.push({
          emailId: raw.id,
          stage: "classify",
          reason: clip(`uncertain ${classification.class} (${classification.confidence}), not extracted: ${classification.reason ?? ""}`),
        });
      }
      continue;
    }

    let result: ExtractResult;
    try {
      result = await deps.extractor(redacted, classification, raw);
    } catch (error) {
      reviewQueue.push({ emailId: raw.id, stage: "extract", reason: clip(`extraction failed: ${errorMessage(error)}`) });
      continue;
    }

    if (!result.ok) {
      if ("skipped" in result) {
        stats.skipped += 1;
      } else {
        reviewQueue.push({ emailId: raw.id, stage: "extract", reason: clip(result.reason) });
      }
      continue;
    }

    const { extraction } = result;
    stats.extracted += 1;
    if (extraction.model === GOLD_EXTRACTION_MODEL) stats.extractionOrigins.gold += 1;
    else if (extraction.cached) stats.extractionOrigins.cache += 1;
    else stats.extractionOrigins.llm += 1;
    if (extraction.confMin < REVIEW_CONFIDENCE_THRESHOLD) {
      reviewQueue.push({
        emailId: raw.id,
        stage: "extract",
        reason: `low extraction confidence ${extraction.confMin.toFixed(2)}`,
      });
    }
    // The matcher derives timestamps from the email date; an unparseable one would throw and abort the whole run
    // (real inboxes / uploads can carry odd Date headers). Route that email to review instead (hard rule 5).
    if (Number.isNaN(Date.parse(redacted.date))) {
      reviewQueue.push({ emailId: raw.id, stage: "match", reason: "email has no readable date, so it can't be matched to an order" });
      continue;
    }
    // The matcher sees the redacted email, so nothing derived from it can carry unredacted PII.
    matchInputs.push({ email: redacted, extraction });
  }

  const matched = matchOrdersWithReasons(matchInputs);
  const allOrders = matched.orders;
  const includedOrders = allOrders.filter((order) => !isExcludedMerchant(order, excluded));
  const { findings, failures } = runRulesIsolated(includedOrders, defaultRules, {
    now: deps.now,
    priceFeed: deps.priceFeed,
  });
  for (const order of includedOrders.filter((candidate) => candidate.needsReview)) {
    const reason = orderReviewReason(order, matched.reviewReasons.get(order.id));
    reviewQueue.push({ emailId: order.messageIds[0], stage: "match", reason, orderId: order.id });
  }
  // An order whose rules failed has no findings; it goes to review so a human can correct and re-run it.
  const failedOrderIds = new Set(failures.map((failure) => failure.orderId));
  const orders = includedOrders.map((order) => (failedOrderIds.has(order.id) ? { ...order, needsReview: true } : order));
  for (const failure of failures) {
    const order = includedOrders.find((candidate) => candidate.id === failure.orderId);
    reviewQueue.push({
      emailId: order?.messageIds[0] ?? failure.orderId,
      stage: "rules",
      reason: clip(`rules failed, no findings for this order: ${failure.reason}`),
      orderId: failure.orderId,
    });
  }

  stats.orders = orders.length;
  stats.excludedOrders = allOrders.length - orders.length;
  stats.findings = findings.length;
  stats.needsReview = reviewQueue.length;
  audit({
    type: "sync_complete",
    detail: `Pipeline finished (${source}): ${orders.length} orders, ${findings.length} findings, ${reviewQueue.length} need review`,
  });
  return { orders, findings, reviewQueue, stats };
}
