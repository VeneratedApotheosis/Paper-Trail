import type { EmailClass } from "@/lib/contracts";
import { sameMerchant } from "./merchant";
import { isStrongRef } from "./refs";

/**
 * Scored duplicate matching (#126 C and E). Pure and deterministic. A pair of emails (or orders) gets a score from
 * explicit weights; hard constraints block a pair outright whatever its score; the score then decides:
 * `merge` (>= AUTO_MERGE_SCORE), `possible` (middle band: flag, do not merge) or `none`.
 */

/** Weight of each feature. Totals are only meaningful against the two thresholds below. */
export const DEDUP_WEIGHTS = {
  /** Same RFC 5322 Message-ID (or, across inboxes, the same body fingerprint). */
  exactCopy: 100,
  /** An order reference (primary or otherRefs) both sides print. */
  sharedRef: 70,
  /** Merchant identity keys intersect (a precondition: different merchants never score). */
  merchant: 10,
  /** Same Gmail thread (strong for lifecycle emails, weak for two confirmations). */
  threadLifecycle: 30,
  threadConfirmation: 10,
  /** Totals equal to the cent / within max($0.50, 2%). */
  amountExact: 25,
  amountClose: 12,
  /** Refund equals one line item's price, or is less than the order total. */
  refundMatchesItem: 15,
  refundPartial: 5,
  /** Exact amount AND within 3 days (the old matcher's ref-less rule, kept for lifecycle emails). */
  amountAndTimingCombo: 15,
  /** Line items shared: >= 80%, >= 50%, any. Lifecycle emails list fewer items, so they weigh more. */
  itemsAllLifecycle: 40,
  itemsHalfLifecycle: 25,
  itemsAnyLifecycle: 10,
  itemsAllConfirmation: 30,
  itemsHalfConfirmation: 18,
  itemsAnyConfirmation: 8,
  /** Date gap, confirmation vs confirmation: <= 1 day, <= 3 days, <= 7 days. */
  gapDayConfirmation: 10,
  gapThreeDaysConfirmation: 6,
  gapWeekConfirmation: 2,
  /** Date gap, lifecycle after order: <= 7 days, then inside the lifecycle window. */
  gapWeekLifecycle: 10,
  gapWindowLifecycle: 5,
  /** A tracking number both sides print (#127): a package belongs to one purchase, whatever the sender or merchant spelling. */
  sharedTracking: 90,
} as const;

/** At or above: merge. Below it but at or above POSSIBLE_DUPLICATE_SCORE: flag as a possible duplicate only. */
export const AUTO_MERGE_SCORE = 60;
export const POSSIBLE_DUPLICATE_SCORE = 35;
/** A lifecycle email joins an order only when its best candidate beats the next one by this much. */
export const AMBIGUITY_MARGIN = 10;
/** Two confirmations with the same total this many days apart are separate charges (subscriptions, repeat buys). */
export const RECURRING_MIN_GAP_DAYS = 20;
/** Lifecycle emails attach to an order within these windows (E); refunds and returns last longer than shipping. */
export const LIFECYCLE_WINDOW_DAYS: Partial<Record<EmailClass, number>> = {
  shipped: 30,
  delivered: 30,
  return_started: 90,
  return_received: 90,
  refund: 90,
  price_adjust: 90,
  cancel: 90,
};
/** A confirmation without an order number joins a numbered one only when sent this close in time. */
const NUMBERLESS_COPY_MAX_DAYS = 3;
const DEFAULT_LIFECYCLE_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const PREDATE_TOLERANCE_DAYS = 1;
const MIN_NAME_CONTAINMENT_CHARS = 8;
const CENT_EPSILON = 0.005;

/** `tracking_number` (#127): a shipping / tracking email shares a tracking number with another email of the purchase. */
export type MergeReason = "message_id" | "fingerprint" | "shared_ref" | "tracking_number" | "thread" | "items_amount" | "only_order";

export interface DedupItem {
  /** Slug of the item name. */
  key: string;
  sku: string | null;
  unitPrice: number;
  qty: number;
}

/** What the scorer needs to know about an email (one extraction) or an order. */
export interface DedupCandidate {
  merchantKeys: string[];
  /** Canonical references, primary first. */
  refs: string[];
  primaryRef: string | null;
  kind: "confirmation" | "lifecycle";
  emailClass: EmailClass;
  currency: string | null;
  /** Order total for a confirmation; event amount (else total) for a lifecycle email. */
  amount: number | null;
  /** Epoch ms of the order / event date. */
  at: number;
  items: DedupItem[];
  /** `mid:` (and, between inboxes, `fp:`) keys: equal keys mean the same message. */
  exactKeys: string[];
  /** `<account>:<threadId>`; null without a Gmail thread. */
  threadKey: string | null;
  /** Normalized tracking numbers the email (or the order's shipments) carry (#127). */
  trackingNumbers?: string[];
}

export interface PairScore {
  score: number;
  reasons: string[];
  /** A hard constraint that forbids merging this pair, whatever the score. */
  blocked: string | null;
  decision: "merge" | "possible" | "none";
  /** Set when decision is `merge`. */
  mergeReason: MergeReason | null;
  /** Merge went ahead but a human should look (e.g. a refund larger than the order total). */
  warning: string | null;
}

function result(partial: Partial<PairScore> & Pick<PairScore, "score">): PairScore {
  return { reasons: [], blocked: null, decision: "none", mergeReason: null, warning: null, ...partial };
}

function blockedPair(reason: string): PairScore {
  return result({ score: 0, blocked: reason });
}

function withinTotalTolerance(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.5, 0.02 * Math.max(a, b)) + 1e-9;
}

function sharedRef(a: DedupCandidate, b: DedupCandidate): boolean {
  if (a.primaryRef !== null && a.primaryRef === b.primaryRef) return true;
  return a.refs.some((ref) => isStrongRef(ref) && b.refs.includes(ref));
}

/**
 * The key that proves two candidates are one message. Message-IDs decide first: when both sides have some and they
 * differ, these are different messages and an identical body fingerprint proves nothing (two identical coffees).
 */
function sharedExactKey(a: DedupCandidate, b: DedupCandidate): string | null {
  const messageIds = (candidate: DedupCandidate) => candidate.exactKeys.filter((key) => key.startsWith("mid:"));
  const shared = messageIds(a).find((key) => messageIds(b).includes(key));
  if (shared) return shared;
  if (messageIds(a).length > 0 && messageIds(b).length > 0) return null;
  // A body fingerprint is only an exact copy when sent within a day (a monthly receipt has the same text every month).
  if (Math.abs(a.at - b.at) > DAY_MS) return null;
  return a.exactKeys.find((key) => b.exactKeys.includes(key)) ?? null;
}

function sharedTrackingNumber(a: DedupCandidate, b: DedupCandidate): string | null {
  const theirs = b.trackingNumbers ?? [];
  return (a.trackingNumbers ?? []).find((number) => theirs.includes(number)) ?? null;
}

/** Lifecycle classes whose tracking numbers describe the outbound package (return labels have their own numbers). */
const TRACKING_CLASSES: readonly EmailClass[] = ["shipped", "delivered"];

function trackingJoinable(a: DedupCandidate, b: DedupCandidate): boolean {
  if (a.kind === "confirmation" && b.kind === "confirmation") return false;
  return [a, b].every((candidate) => candidate.kind === "confirmation" || TRACKING_CLASSES.includes(candidate.emailClass));
}

function sameItem(a: DedupItem, b: DedupItem): boolean {
  if (a.sku && b.sku && a.sku.toLowerCase() === b.sku.toLowerCase()) return true;
  if (a.key === b.key) return true;
  const [short, long] = a.key.length <= b.key.length ? [a.key, b.key] : [b.key, a.key];
  return short.length >= MIN_NAME_CONTAINMENT_CHARS && long.includes(short);
}

/** Share of the items that appear on both sides, relative to the smaller (`contained`) or the larger list. */
function itemOverlap(a: readonly DedupItem[], b: readonly DedupItem[], relativeTo: "smaller" | "larger"): number {
  if (a.length === 0 || b.length === 0) return 0;
  const matches = a.filter((item) => b.some((other) => sameItem(item, other))).length;
  return matches / (relativeTo === "smaller" ? Math.min(a.length, b.length) : Math.max(a.length, b.length));
}

function amountsEqual(a: number | null, b: number | null): boolean {
  return a !== null && b !== null && Math.abs(a - b) <= CENT_EPSILON;
}

function currencyConflict(a: DedupCandidate, b: DedupCandidate): boolean {
  return a.currency !== null && b.currency !== null && a.currency !== b.currency;
}

function mergeReasonOfKey(key: string): MergeReason {
  return key.startsWith("fp:") ? "fingerprint" : "message_id";
}

function scoreConfirmations(a: DedupCandidate, b: DedupCandidate): PairScore {
  const exactKey = sharedExactKey(a, b);
  if (exactKey) return result({ score: DEDUP_WEIGHTS.exactCopy, decision: "merge", mergeReason: mergeReasonOfKey(exactKey), reasons: ["same email"] });
  const ref = sharedRef(a, b);
  if (a.primaryRef !== null && b.primaryRef !== null && !ref) return blockedPair("different order references");
  if (currencyConflict(a, b)) return blockedPair("different currencies");
  const gapDays = Math.abs(a.at - b.at) / DAY_MS;
  const equal = amountsEqual(a.amount, b.amount);
  if (equal && gapDays >= RECURRING_MIN_GAP_DAYS) return blockedPair("same total again ~monthly (recurring charge)");

  let score = DEDUP_WEIGHTS.merchant;
  const reasons = ["same merchant"];
  if (ref) { score += DEDUP_WEIGHTS.sharedRef; reasons.push("shared order number"); }
  if (a.threadKey !== null && a.threadKey === b.threadKey) { score += DEDUP_WEIGHTS.threadConfirmation; reasons.push("same Gmail thread"); }
  if (equal) { score += DEDUP_WEIGHTS.amountExact; reasons.push("same total"); }
  else if (a.amount !== null && b.amount !== null && withinTotalTolerance(a.amount, b.amount)) { score += DEDUP_WEIGHTS.amountClose; reasons.push("close total"); }
  if (gapDays <= 1) { score += DEDUP_WEIGHTS.gapDayConfirmation; reasons.push("within a day"); }
  else if (gapDays <= 3) { score += DEDUP_WEIGHTS.gapThreeDaysConfirmation; reasons.push("within 3 days"); }
  else if (gapDays <= 7) score += DEDUP_WEIGHTS.gapWeekConfirmation;
  const overlap = itemOverlap(a.items, b.items, "larger");
  if (overlap >= 0.8) { score += DEDUP_WEIGHTS.itemsAllConfirmation; reasons.push("same items"); }
  else if (overlap >= 0.5) { score += DEDUP_WEIGHTS.itemsHalfConfirmation; reasons.push("most items shared"); }
  else if (overlap > 0) score += DEDUP_WEIGHTS.itemsAnyConfirmation;

  // Two confirmations are one purchase only when they name the same order (or one lost its number); look-alikes are flagged.
  if (ref && score >= AUTO_MERGE_SCORE) return result({ score, reasons, decision: "merge", mergeReason: "shared_ref" });
  // A copy that lost its order number joins the numbered one when everything else agrees; two numberless look-alikes do not.
  const oneSideNumberless = (a.primaryRef === null) !== (b.primaryRef === null);
  if (oneSideNumberless && gapDays <= NUMBERLESS_COPY_MAX_DAYS && score >= AUTO_MERGE_SCORE) return result({ score, reasons, decision: "merge", mergeReason: "items_amount" });
  if (score >= POSSIBLE_DUPLICATE_SCORE) {
    return result({ score, reasons: [...reasons, "no shared order number"], decision: "possible" });
  }
  return result({ score, reasons });
}

function scoreLifecycle(order: DedupCandidate, event: DedupCandidate): PairScore {
  const exactKey = sharedExactKey(order, event);
  if (exactKey) return result({ score: DEDUP_WEIGHTS.exactCopy, decision: "merge", mergeReason: mergeReasonOfKey(exactKey), reasons: ["same email"] });
  const isRefund = event.emailClass === "refund";
  const overTotal = isRefund && event.amount !== null && order.amount !== null && event.amount > order.amount + CENT_EPSILON;
  if (sharedRef(order, event)) {
    return result({
      score: DEDUP_WEIGHTS.merchant + DEDUP_WEIGHTS.sharedRef, decision: "merge", mergeReason: "shared_ref", reasons: ["shared order number"],
      warning: overTotal ? "refund is more than the order total" : null,
    });
  }
  if (event.refs.length > 0 && order.primaryRef !== null) return blockedPair("references a different order");
  const window = LIFECYCLE_WINDOW_DAYS[event.emailClass] ?? DEFAULT_LIFECYCLE_WINDOW_DAYS;
  const gapDays = (event.at - order.at) / DAY_MS;
  if (gapDays < -PREDATE_TOLERANCE_DAYS) return blockedPair("event is dated before the order");
  if (gapDays > window) return blockedPair(`outside the ${window}-day window`);
  if (overTotal) return blockedPair("refund is more than the order total");
  if (currencyConflict(order, event)) return blockedPair("different currencies");

  let score = DEDUP_WEIGHTS.merchant;
  const reasons = ["same merchant"];
  const threaded = event.threadKey !== null && event.threadKey === order.threadKey;
  if (threaded) { score += DEDUP_WEIGHTS.threadLifecycle; reasons.push("same Gmail thread"); }
  const overlap = itemOverlap(event.items, order.items, "smaller");
  if (overlap >= 0.8) { score += DEDUP_WEIGHTS.itemsAllLifecycle; reasons.push("same items"); }
  else if (overlap >= 0.5) { score += DEDUP_WEIGHTS.itemsHalfLifecycle; reasons.push("most items shared"); }
  else if (overlap > 0) score += DEDUP_WEIGHTS.itemsAnyLifecycle;
  const exactAmount = amountsEqual(event.amount, order.amount);
  if (exactAmount) { score += DEDUP_WEIGHTS.amountExact; reasons.push("same amount"); }
  else if (event.amount !== null && order.amount !== null) {
    if (withinTotalTolerance(event.amount, order.amount)) { score += DEDUP_WEIGHTS.amountClose; reasons.push("close amount"); }
    else if (isRefund && order.items.some((item) => amountsEqual(item.unitPrice, event.amount) || amountsEqual(item.unitPrice * item.qty, event.amount))) {
      score += DEDUP_WEIGHTS.refundMatchesItem; reasons.push("refund equals an item price");
    } else if (isRefund && event.amount < order.amount) score += DEDUP_WEIGHTS.refundPartial;
  }
  if (gapDays <= 7) { score += DEDUP_WEIGHTS.gapWeekLifecycle; reasons.push("within a week"); }
  else score += DEDUP_WEIGHTS.gapWindowLifecycle;
  if (exactAmount && gapDays <= 3) { score += DEDUP_WEIGHTS.amountAndTimingCombo; reasons.push("amount and timing agree"); }

  if (score >= AUTO_MERGE_SCORE) {
    return result({ score, reasons, decision: "merge", mergeReason: threaded && overlap + (exactAmount ? 1 : 0) === 0 ? "thread" : "items_amount" });
  }
  if (score >= POSSIBLE_DUPLICATE_SCORE) return result({ score, reasons, decision: "possible" });
  return result({ score, reasons });
}

/**
 * Scores one pair. Symmetric: a confirmation is always the order side, whichever argument it is. A shared tracking
 * number (#127) joins shipping emails across senders (merchant, carrier, convenience store) before merchant identity is
 * looked at. It outranks a differing reference (a shipment id is often printed where an order number belongs) and only
 * yields to a currency conflict; two order confirmations never join on it.
 */
export function scorePair(a: DedupCandidate, b: DedupCandidate): PairScore {
  const tracking = trackingJoinable(a, b) ? sharedTrackingNumber(a, b) : null;
  if (tracking !== null) {
    const exactKey = sharedExactKey(a, b);
    if (exactKey) return result({ score: DEDUP_WEIGHTS.exactCopy, decision: "merge", mergeReason: mergeReasonOfKey(exactKey), reasons: ["same email"] });
    if (sharedRef(a, b)) return result({ score: DEDUP_WEIGHTS.merchant + DEDUP_WEIGHTS.sharedRef, decision: "merge", mergeReason: "shared_ref", reasons: ["shared order number"] });
    if (currencyConflict(a, b)) return blockedPair("different currencies");
    return result({ score: DEDUP_WEIGHTS.sharedTracking, decision: "merge", mergeReason: "tracking_number", reasons: ["shared tracking number"] });
  }
  if (!sameMerchant(a.merchantKeys, b.merchantKeys)) return blockedPair("different merchant");
  if (a.kind === "confirmation" && b.kind === "confirmation") return scoreConfirmations(a, b);
  if (a.kind === "lifecycle" && b.kind === "lifecycle") {
    const exactKey = sharedExactKey(a, b);
    if (exactKey) return result({ score: DEDUP_WEIGHTS.exactCopy, decision: "merge", mergeReason: mergeReasonOfKey(exactKey), reasons: ["same email"] });
    if (sharedRef(a, b)) return result({ score: DEDUP_WEIGHTS.merchant + DEDUP_WEIGHTS.sharedRef, decision: "merge", mergeReason: "shared_ref", reasons: ["shared order number"] });
    return result({ score: 0 });
  }
  return a.kind === "confirmation" ? scoreLifecycle(a, b) : scoreLifecycle(b, a);
}
