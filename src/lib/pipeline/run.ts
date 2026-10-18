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
  /** Max extractor calls in flight at once (default 4; 1 = sequential). Output order never depends on it. */
  extractConcurrency?: number;
  /**
   * Called once per email in input order when the run finishes (#117 quality tracking). It sees redacted text only;
   * what it keeps is its own business, so it must not persist anything but redacted data.
   */
  observer?: (observation: PipelineEmailObservation) => void;
  /**
   * Class the user set for an email by hand (#117 "this is a receipt" / "not a receipt" feedback). A receipt class
   * overrides the classifier and bypasses the prefilter; marketing / not_receipt skips extraction.
   */
  classOverride?: (emailId: string) => EmailClass | undefined;
}

/** How one email ended up in a run; see PipelineDeps.observer. */
export type PipelineEmailOutcome = "prefiltered" | "skipped" | "extracted" | "extraction_failed";

export interface PipelineEmailObservation {
  /** Redacted copy: `to` and `from` are still the raw headers, callers must not keep them as they are. */
  email: RedactedEmail;
  /** Absent for emails dropped by the prefilter (they are never classified). */
  classification?: Classification;
  /** True when `classOverride` decided the class instead of classify(). */
  classOverridden: boolean;
  outcome: PipelineEmailOutcome;
  /** Lowest extraction confidence; set when `outcome` is "extracted". */
  confMin?: number;
}

export const DEFAULT_EXTRACT_CONCURRENCY = 4;

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

function observedOutcome(outcome: EmailOutcome): PipelineEmailOutcome {
  if (outcome.prefilteredOut) return "prefiltered";
  if (outcome.extracted) return "extracted";
  return outcome.skipped ? "skipped" : "extraction_failed";
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

/** One email's contribution, filled in by add()/the extraction task and merged in input order by finish(). */
interface EmailOutcome {
  prefilteredOut: boolean;
  classification?: EmailClass;
  /** Kept for the observer only. */
  observed?: { email: RedactedEmail; classification?: Classification; classOverridden: boolean; confMin?: number };
  skipped: boolean;
  origin?: keyof PipelineStats["extractionOrigins"];
  extracted: boolean;
  review: ReviewQueueItem[];
  matchInput?: MatchInput;
}

/** A pipeline run fed one email at a time, so extraction can start while later emails are still being fetched. */
export interface PipelineRun {
  /**
   * Classifies and redacts synchronously, then starts extraction as soon as one of `extractConcurrency` slots is free.
   * The returned promise resolves once the email's extraction has started (or immediately if it needs none), so a
   * caller that awaits it gets backpressure instead of an unbounded queue. Emails keep the order add() was called in.
   */
  add(raw: RawEmail): Promise<void>;
  /** Waits for in-flight extractions, then matches orders and runs rules once over everything added. */
  finish(): Promise<PipelineResult>;
}

/**
 * Streaming form of runPipeline. Extraction results are stored per input index and merged in that order, so stats,
 * review queue and matcher input are identical to a sequential run whatever order the extractor calls finish in.
 * `expectedEmails` only labels the sync_start audit row (the true count is known once add() has been called).
 */
export function createPipelineRun(deps: PipelineDeps, expectedEmails?: number): PipelineRun {
  const auditClock = deps.auditClock ?? (() => new Date());
  const audit = (event: Omit<PipelineAuditEvent, "at">) => deps.audit?.({ at: auditClock().toISOString(), ...event });
  const source = deps.sourceLabel ?? "pipeline";
  const excluded = deps.excludedMerchants ?? new Set<string>();
  const extractConcurrency = Math.max(1, Math.floor(deps.extractConcurrency ?? DEFAULT_EXTRACT_CONCURRENCY));
  audit({
    type: "sync_start",
    detail: `Pipeline started (${source}): ${expectedEmails === undefined ? "streaming" : expectedEmails} emails`,
  });

  const outcomes: EmailOutcome[] = [];
  const extractions: Promise<void>[] = [];
  const waiting: Array<() => void> = [];
  let inFlight = 0;
  let finished = false;

  function acquireSlot(): Promise<void> {
    if (inFlight < extractConcurrency) {
      inFlight += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => waiting.push(resolve));
  }
  function releaseSlot(): void {
    const next = waiting.shift();
    if (next) next(); // the slot passes straight to the next email, so inFlight never exceeds the cap
    else inFlight -= 1;
  }

  async function extractEmail(outcome: EmailOutcome, raw: RawEmail, redacted: RedactedEmail, classification: Classification) {
    let result: ExtractResult;
    try {
      result = await deps.extractor(redacted, classification, raw);
    } catch (error) {
      outcome.review.push({ emailId: raw.id, stage: "extract", reason: clip(`extraction failed: ${errorMessage(error)}`) });
      return;
    }

    if (!result.ok) {
      if ("skipped" in result) {
        outcome.skipped = true;
      } else {
        outcome.review.push({ emailId: raw.id, stage: "extract", reason: clip(result.reason) });
      }
      return;
    }

    const { extraction } = result;
    outcome.extracted = true;
    if (outcome.observed) outcome.observed.confMin = extraction.confMin;
    if (extraction.model === GOLD_EXTRACTION_MODEL) outcome.origin = "gold";
    else if (extraction.cached) outcome.origin = "cache";
    else outcome.origin = "llm";
    if (extraction.confMin < REVIEW_CONFIDENCE_THRESHOLD) {
      outcome.review.push({
        emailId: raw.id,
        stage: "extract",
        reason: `low extraction confidence ${extraction.confMin.toFixed(2)}`,
      });
    }
    // The matcher derives timestamps from the email date; an unparseable one would throw and abort the whole run
    // (real inboxes / uploads can carry odd Date headers). Route that email to review instead (hard rule 5).
    if (Number.isNaN(Date.parse(redacted.date))) {
      outcome.review.push({ emailId: raw.id, stage: "match", reason: "email has no readable date, so it can't be matched to an order" });
      return;
    }
    // The matcher sees the redacted email, so nothing derived from it can carry unredacted PII.
    outcome.matchInput = { email: redacted, extraction };
  }

  function add(raw: RawEmail): Promise<void> {
    if (finished) throw new Error("Pipeline run already finished");
    const outcome: EmailOutcome = { prefilteredOut: false, skipped: false, extracted: false, review: [] };
    outcomes.push(outcome);
    const override = deps.classOverride?.(raw.id);
    if (!override && deps.applyPrefilter && !isReceiptLike(raw).keep) {
      outcome.prefilteredOut = true;
      if (deps.observer) outcome.observed = { email: redact(raw), classOverridden: false };
      return Promise.resolve();
    }

    // Classify the raw email: redaction tokenizes addresses, which hides look-alike sender domains in forwards.
    const classification: Classification = override
      ? { emailId: raw.id, class: override, confidence: 1, reason: "set by the user" }
      : classify(raw);
    outcome.classification = classification.class;
    const redacted = redact(raw);
    if (deps.observer) outcome.observed = { email: redacted, classification, classOverridden: override !== undefined };

    if (SKIPPED_EXTRACTION_CLASSES.has(classification.class)) {
      outcome.skipped = true;
      if (classification.confidence < REVIEW_CONFIDENCE_THRESHOLD) {
        outcome.review.push({
          emailId: raw.id,
          stage: "classify",
          reason: clip(`uncertain ${classification.class} (${classification.confidence}), not extracted: ${classification.reason ?? ""}`),
        });
      }
      return Promise.resolve();
    }

    const started = acquireSlot();
    extractions.push(started.then(() => extractEmail(outcome, raw, redacted, classification)).finally(releaseSlot));
    return started;
  }

  async function finish(): Promise<PipelineResult> {
    finished = true;
    await Promise.all(extractions);
    const reviewQueue: ReviewQueueItem[] = [];
    const stats: PipelineStats = {
      emails: outcomes.length,
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
    const matchInputs: MatchInput[] = [];
    for (const outcome of outcomes) {
      if (outcome.prefilteredOut) stats.prefilteredOut += 1;
      if (outcome.classification) stats.classes[outcome.classification] = (stats.classes[outcome.classification] ?? 0) + 1;
      if (outcome.skipped) stats.skipped += 1;
      if (outcome.extracted) stats.extracted += 1;
      if (outcome.origin) stats.extractionOrigins[outcome.origin] += 1;
      reviewQueue.push(...outcome.review);
      if (outcome.matchInput) matchInputs.push(outcome.matchInput);
      if (deps.observer && outcome.observed) deps.observer({ ...outcome.observed, outcome: observedOutcome(outcome) });
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

  return { add, finish };
}

/** Runs the whole pipeline over an in-memory list; see createPipelineRun() for the streaming form. */
export async function runPipeline(emails: readonly RawEmail[], deps: PipelineDeps): Promise<PipelineResult> {
  const run = createPipelineRun(deps, emails.length);
  for (const raw of emails) await run.add(raw);
  return run.finish();
}
