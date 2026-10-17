import type {
  Finding,
  FindingEvidence,
  NormalizedOrder,
  OrderEvent,
  OrderEventType,
} from "@/lib/contracts";
import { findingId, ruleVersionOf, severityFor, type Rule, type RuleContext } from "./engine";
import { refundTolerance, roundCents, sumMoney, sumMoneyBy } from "./money";
import { addDays, toDateString } from "./time";

const REFUND_RULE = { id: "R1", version: "1" } as const;
const REFUND_RULE_VERSION = ruleVersionOf(REFUND_RULE);

/** Default refund SLA when the email text states none: 10 days after received, 14 after drop-off/start only. */
const DEFAULT_SLA_DAYS = { strong: 10, weak: 14 } as const;

type RefundTriggerType = "strong" | "weak";

interface RefundTrigger {
  event: OrderEvent;
  type: RefundTriggerType;
}

/**
 * Explain payload for R1 findings. A superset of the UI's FindingExplain (src/lib/types.ts):
 * rule, summary, dates, sourceQuote, confidence map 1:1; the rest feeds the "Why?" panel math.
 */
export type RefundExplain = {
  rule: "refund_overdue" | "refund_short";
  summary: string;
  triggerType: RefundTriggerType;
  /** ISO datetime of the triggering return event. */
  triggerAt: string;
  slaDays: number;
  slaSource: "email_text" | "default";
  /** ISO datetime the refund was expected by (trigger + SLA days). */
  expectedBy: string;
  expectedAmount: number;
  refundedAmount?: number;
  /** Rounded to cents for display. */
  tolerance: number;
  /** Values are ISO datetimes. */
  dates: { label: string; value: string }[];
  /** Lowest confidence among the events involved. */
  confidence: number;
  /** Policy quote when known, else the triggering event's evidence quote. */
  sourceQuote: string;
};

const EVENT_LABELS: Partial<Record<OrderEventType, string>> = {
  return_received: "Return received",
  return_dropped: "Return dropped off",
  return_started: "Return started",
  refund_issued: "Refund issued",
};

function sortedByTime(events: readonly OrderEvent[]): OrderEvent[] {
  return [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Earliest return_received (strong), else earliest return_dropped / return_started (weak). */
function findReturnTrigger(events: readonly OrderEvent[]): RefundTrigger | null {
  const received = events.find((event) => event.type === "return_received");
  if (received) return { event: received, type: "strong" };
  const weak = events.find(
    (event) => event.type === "return_dropped" || event.type === "return_started",
  );
  return weak ? { event: weak, type: "weak" } : null;
}

/**
 * Expected refund for the triggering return event:
 * Σ(returnedQty × unitPrice) + tax × returnedSubtotal / subtotal, rounded to cents.
 * Returned items are the event's lineItemIds (item.returnedQty when > 0, else the full qty).
 * No lineItemIds, no known ids, or every item fully returned => the order total.
 */
export function expectedRefundAmount(order: NormalizedOrder, returnEvent: OrderEvent): number {
  const returnedIds = new Set(returnEvent.lineItemIds ?? []);
  const returnedItems = order.lineItems
    .filter((item) => returnedIds.has(item.id))
    .map((item) => ({
      item,
      qty: Math.min(item.qty, item.returnedQty > 0 ? item.returnedQty : item.qty),
    }));
  const allReturned = order.lineItems.every((item) =>
    returnedItems.some((returned) => returned.item.id === item.id && returned.qty === item.qty),
  );
  if (returnedItems.length === 0 || allReturned) return roundCents(order.total);

  const returnedSubtotal = returnedItems.reduce(
    (total, { item, qty }) => total + qty * item.unitPrice,
    0,
  );
  const subtotal = order.subtotal ?? sumMoneyBy(order.lineItems, (item) => item.qty * item.unitPrice);
  const proratedTax = subtotal > 0 ? ((order.tax ?? 0) * returnedSubtotal) / subtotal : 0;
  return roundCents(returnedSubtotal + proratedTax);
}

function formatAmount(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}

function generatedQuote(event: OrderEvent, currency: string): string {
  const label = EVENT_LABELS[event.type] ?? event.type;
  const date = toDateString(new Date(event.at));
  if (event.type === "refund_issued" && event.amount != null) {
    return `Refund of ${formatAmount(event.amount, currency)} issued on ${date}`;
  }
  return `${label} on ${date}`;
}

function evidenceFor(events: readonly OrderEvent[], currency: string): FindingEvidence[] {
  return events.map((event) => ({
    messageId: event.messageId,
    quote: event.evidence ?? generatedQuote(event, currency),
  }));
}

function evaluateRefund(order: NormalizedOrder, ctx: RuleContext): Finding[] {
  const events = sortedByTime(order.events);
  const trigger = findReturnTrigger(events);
  if (!trigger) return [];

  const policy = order.merchant.policy;
  const triggerAt = new Date(trigger.event.at);
  const slaDays = policy.refundSlaDays ?? DEFAULT_SLA_DAYS[trigger.type];
  const slaSource = policy.refundSlaDays != null ? "email_text" : "default";
  const expectedBy = addDays(triggerAt, slaDays);
  const expectedAmount = expectedRefundAmount(order, trigger.event);
  const tolerance = refundTolerance(expectedAmount);

  const afterTrigger = events.filter((event) => Date.parse(event.at) >= triggerAt.getTime());
  // Store credit counts as matched: no overdue/short finding.
  if (afterTrigger.some((event) => event.type === "store_credit")) return [];
  const refunds = afterTrigger.filter((event) => event.type === "refund_issued");

  const triggerLabel = EVENT_LABELS[trigger.event.type] ?? trigger.event.type;
  const involved = [trigger.event, ...refunds];
  const evidence = evidenceFor(involved, order.currency);
  const explainBase = {
    triggerType: trigger.type,
    triggerAt: triggerAt.toISOString(),
    slaDays,
    slaSource,
    expectedBy: expectedBy.toISOString(),
    expectedAmount,
    tolerance: roundCents(tolerance),
    confidence: Math.min(...involved.map((event) => event.conf)),
    sourceQuote: policy.policyQuote ?? evidence[0].quote,
  } as const;
  const triggerDates = [
    { label: triggerLabel, value: triggerAt.toISOString() },
    { label: "Refund expected by", value: expectedBy.toISOString() },
  ];

  if (refunds.length === 0) {
    // Overdue only once now is strictly past E. now in [E-3d, E] is "due soon", which is not a finding.
    if (ctx.now.getTime() <= expectedBy.getTime()) return [];
    const summary =
      `${triggerLabel} on ${toDateString(triggerAt)}; no refund within ${slaDays} days ` +
      `(expected by ${toDateString(expectedBy)}).`;
    const explain: RefundExplain = {
      rule: "refund_overdue",
      summary,
      ...explainBase,
      dates: triggerDates,
    };
    return [
      buildFinding(order, "refund_overdue", expectedAmount, expectedBy.toISOString(), summary, evidence, explain),
    ];
  }

  // A refund without a stated amount is matched but cannot be checked for shortfall.
  if (refunds.some((refund) => refund.amount == null)) return [];
  const refundedAmount = sumMoney(refunds.map((refund) => refund.amount ?? 0));
  const shortBy = roundCents(expectedAmount - refundedAmount);
  // Small epsilon so float noise in 2% of expected never flips a boundary case.
  if (shortBy <= tolerance + 1e-9) return [];

  const lastRefund = refunds[refunds.length - 1];
  const summary =
    `Refund of ${formatAmount(refundedAmount, order.currency)} is ${formatAmount(shortBy, order.currency)} ` +
    `less than the ${formatAmount(expectedAmount, order.currency)} expected.`;
  const explain: RefundExplain = {
    rule: "refund_short",
    summary,
    ...explainBase,
    refundedAmount,
    dates: [...triggerDates, { label: "Refund issued", value: new Date(lastRefund.at).toISOString() }],
  };
  return [buildFinding(order, "refund_short", shortBy, null, summary, evidence, explain)];
}

function buildFinding(
  order: NormalizedOrder,
  kind: "refund_overdue" | "refund_short",
  amountAtStake: number,
  dueAt: string | null,
  summary: string,
  evidence: FindingEvidence[],
  explain: RefundExplain,
): Finding {
  return {
    id: findingId(kind, order.id),
    kind,
    orderId: order.id,
    amountAtStake,
    currency: order.currency,
    dueAt,
    severity: severityFor(amountAtStake),
    status: "open",
    ruleVersion: REFUND_RULE_VERSION,
    summary,
    evidence,
    explain,
    simulated: false,
  };
}

/**
 * R1 refund tracker (deepdive_S14 §4, scope_features F2.1).
 * Trigger T = return_received (strong) else return_dropped/return_started (weak); E = T + SLA days.
 * refund_overdue: now > E with no refund_issued/store_credit at or after T.
 * refund_short: refund_issued total < expected − max($0.50, 2%).
 */
export const refundRule: Rule = {
  ...REFUND_RULE,
  evaluate: evaluateRefund,
};
