import type {
  Finding,
  FindingEvidence,
  NormalizedOrder,
  OrderEvent,
  OrderEventType,
} from "@/lib/contracts";
import { findingId, ruleVersionOf, severityFor, type Rule, type RuleContext } from "./engine";
import { roundCents } from "./money";
import { resolveReturnWindow, type ReturnWindowAnchor, type ReturnWindowSource } from "./policies";
import { addDays, DAY_MS, toDateString } from "./time";

const RETURN_RULE = { id: "R2", version: "1" } as const;
const RETURN_RULE_VERSION = ruleVersionOf(RETURN_RULE);

/** Alert once the deadline is at most this many days away (and not yet past). */
const ALERT_DAYS = 7;
/** Below this confidence the "Why?" panel shows a "check policy" badge (scope_features F2.2). */
const CHECK_POLICY_CONFIDENCE = 0.7;

/** Any of these means a return is already underway, so the window alert is suppressed. */
const RETURN_EVENT_TYPES: readonly OrderEventType[] = [
  "return_started",
  "return_dropped",
  "return_received",
];

/**
 * Explain payload for R2 findings. A superset of the UI's FindingExplain (src/lib/types.ts):
 * rule, summary, dates, sourceQuote, confidence map 1:1; the rest feeds the "Why?" panel math.
 */
export type ReturnExplain = {
  rule: "return_deadline";
  summary: string;
  anchorType: ReturnWindowAnchor;
  /** ISO datetime the window counts from (delivery or order time). */
  anchorAt: string;
  windowDays: number;
  windowSource: ReturnWindowSource;
  /** ISO datetime the window closes (anchor + window days). */
  deadline: string;
  /** Whole days left, rounded up, never negative. */
  daysLeft: number;
  /** Values are ISO datetimes. */
  dates: { label: string; value: string }[];
  /** Lowest of the order's extraction confidence and the delivered event's confidence (delivery anchor). */
  confidence: number;
  /** Policy quote when known, else the evidence quote. */
  sourceQuote: string;
  /** Present (true) when confidence < 0.7: the window should be checked against the quote. */
  checkPolicy?: true;
};

function earliestDelivered(events: readonly OrderEvent[]): OrderEvent | null {
  const delivered = events.filter((event) => event.type === "delivered");
  if (delivered.length === 0) return null;
  return delivered.reduce((earliest, event) =>
    Date.parse(event.at) < Date.parse(earliest.at) ? event : earliest,
  );
}

function isSuppressed(order: NormalizedOrder): boolean {
  return (
    order.merchant.policy.nonReturnable ||
    order.events.some((event) => event.type === "cancel" || RETURN_EVENT_TYPES.includes(event.type))
  );
}

function daysLeftLabel(daysLeft: number): string {
  return daysLeft === 1 ? "1 day left" : `${daysLeft} days left`;
}

function evaluateReturn(order: NormalizedOrder, ctx: RuleContext): Finding[] {
  if (isSuppressed(order)) return [];

  const window = resolveReturnWindow(order);
  const delivered = window.anchor === "delivery" ? earliestDelivered(order.events) : null;
  const anchorType: ReturnWindowAnchor = delivered ? "delivery" : "order";
  const anchorAt = new Date(delivered ? delivered.at : order.placedAt);
  const deadline = addDays(anchorAt, window.days);

  const remainingMs = deadline.getTime() - ctx.now.getTime();
  if (remainingMs < 0 || remainingMs > ALERT_DAYS * DAY_MS) return [];

  const orderMessageId = order.messageIds[0];
  const evidenceMessageId = window.quote != null || !delivered ? orderMessageId : delivered.messageId;
  // A normalized order always has a source email; without one there is nothing to cite.
  if (evidenceMessageId === undefined) return [];

  const anchorLabel = delivered ? "Delivered" : "Ordered";
  const evidence: FindingEvidence[] = [
    {
      messageId: evidenceMessageId,
      quote: window.quote ?? `${anchorLabel} on ${toDateString(anchorAt)}`,
    },
  ];

  const daysLeft = Math.max(0, Math.ceil(remainingMs / DAY_MS));
  const summary = `Return window closes ${toDateString(deadline)} (${daysLeftLabel(daysLeft)}).`;
  const confidence = delivered ? Math.min(order.confMin, delivered.conf) : order.confMin;
  const explain: ReturnExplain = {
    rule: "return_deadline",
    summary,
    anchorType,
    anchorAt: anchorAt.toISOString(),
    windowDays: window.days,
    windowSource: window.source,
    deadline: deadline.toISOString(),
    daysLeft,
    dates: [
      { label: anchorLabel, value: anchorAt.toISOString() },
      { label: "Return by", value: deadline.toISOString() },
    ],
    confidence,
    sourceQuote: evidence[0].quote,
    ...(confidence < CHECK_POLICY_CONFIDENCE ? { checkPolicy: true as const } : {}),
  };

  const amountAtStake = roundCents(order.total);
  return [
    {
      id: findingId("return_deadline", order.id),
      kind: "return_deadline",
      orderId: order.id,
      amountAtStake,
      currency: order.currency,
      dueAt: deadline.toISOString(),
      severity: severityFor(amountAtStake),
      status: "open",
      ruleVersion: RETURN_RULE_VERSION,
      summary,
      evidence,
      explain,
      simulated: false,
    },
  ];
}

/**
 * R2 return deadline (deepdive_S14 §4, scope_features F2.2, issue #14).
 * Anchor A = earliest delivered event when the window counts from delivery and one exists, else placedAt;
 * deadline = A + window days (policy, else 30 from the order date).
 * return_deadline: 0 <= deadline − now <= 7 days, with no return/cancel event and a returnable order.
 */
export const returnRule: Rule = {
  ...RETURN_RULE,
  evaluate: evaluateReturn,
};
