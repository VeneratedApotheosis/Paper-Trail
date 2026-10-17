import type {
  Finding,
  FindingEvidence,
  NormalizedLineItem,
  NormalizedOrder,
} from "@/lib/contracts";
import {
  latestPrice,
  type PriceFeed,
  type PriceObservation,
  type PriceSource,
} from "@/lib/prices/feed";
import { findingId, ruleVersionOf, severityFor, type Rule, type RuleContext } from "./engine";
import { roundCents } from "./money";
import { addDays, toDateString } from "./time";

const PRICE_DROP_RULE = { id: "R3", version: "1" } as const;
const PRICE_DROP_RULE_VERSION = ruleVersionOf(PRICE_DROP_RULE);

/** Price adjustment window when the email text states none (deepdive_S14 §4 R3). */
const DEFAULT_PRICE_ADJUST_DAYS = 14;
/** A drop must be at least max($5, 5% of what was paid for the line) to be worth claiming. */
const MIN_DROP_AMOUNT = 5;
const MIN_DROP_FRACTION = 0.05;
/** Evidence-quote message id for mock price feed observations (they have no source email). */
const PRICE_FEED_MESSAGE_ID = "price-feed";
/** EvidenceSchema caps quotes at 200 chars; generated quotes embed item names of any length. */
const MAX_QUOTE_LENGTH = 200;

/**
 * Explain payload for R3 findings. A superset of the UI's FindingExplain (src/lib/types.ts):
 * rule, summary, dates, sourceQuote, confidence map 1:1; the rest feeds the "Why?" panel math.
 */
export type PriceDropExplain = {
  rule: "price_drop";
  summary: string;
  paidUnitPrice: number;
  currentPrice: number;
  /** Quantity still held (qty − returnedQty). */
  qty: number;
  /** (paidUnitPrice − currentPrice) × qty, rounded to cents. */
  drop: number;
  /** max($5, 5% of paidUnitPrice × qty), rounded to cents. */
  threshold: number;
  windowDays: number;
  windowSource: "email_text" | "default";
  /** ISO datetime the adjustment must be claimed by (placedAt + windowDays). */
  adjustBy: string;
  priceSource: PriceSource;
  /** ISO datetime the current price was observed. */
  observedAt: string;
  /** Values are ISO datetimes. */
  dates: { label: string; value: string }[];
  /** The order's lowest extraction confidence. */
  confidence: number;
  /** Policy quote when known, else the generated paid-price quote. */
  sourceQuote: string;
};

function formatAmount(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}

function formatMoney(amount: number, currency: string): string {
  return currency === "USD" ? `$${amount.toFixed(2)}` : formatAmount(amount, currency);
}

function clipQuote(quote: string): string {
  return quote.length <= MAX_QUOTE_LENGTH ? quote : `${quote.slice(0, MAX_QUOTE_LENGTH - 1)}…`;
}

function evidenceFor(
  order: NormalizedOrder,
  item: NormalizedLineItem,
  current: PriceObservation,
): FindingEvidence[] {
  const orderQuote =
    order.merchant.policy.policyQuote ??
    clipQuote(
      `Paid ${formatAmount(item.unitPrice, order.currency)} for ${item.name} on ` +
        toDateString(new Date(order.placedAt)),
    );
  const evidence: FindingEvidence[] = [{ messageId: order.messageIds[0], quote: orderQuote }];
  if (current.source === "mock") {
    evidence.push({
      messageId: PRICE_FEED_MESSAGE_ID,
      quote:
        `Simulated price feed: ${formatAmount(current.price, current.currency)} observed ` +
        toDateString(new Date(current.observedAt)),
    });
  }
  return evidence;
}

function evaluateLineItem(
  order: NormalizedOrder,
  item: NormalizedLineItem,
  priceFeed: PriceFeed,
  now: Date,
): Finding | null {
  if (!item.sku) return null;
  const heldQty = item.qty - item.returnedQty;
  if (heldQty <= 0) return null;

  const policy = order.merchant.policy;
  const placedAt = new Date(order.placedAt);
  const windowDays = policy.priceAdjustDays ?? DEFAULT_PRICE_ADJUST_DAYS;
  const windowSource = policy.priceAdjustDays != null ? "email_text" : "default";
  const adjustBy = addDays(placedAt, windowDays);
  if (now.getTime() > adjustBy.getTime()) return null;

  const current = latestPrice(priceFeed, order.merchant.name, item.sku, now);
  if (!current || current.currency !== order.currency) return null;

  const drop = (item.unitPrice - current.price) * heldQty;
  const threshold = Math.max(MIN_DROP_AMOUNT, MIN_DROP_FRACTION * item.unitPrice * heldQty);
  // Small epsilon so float noise never flips a boundary case (drop exactly at the threshold fires).
  if (drop < threshold - 1e-9) return null;

  const amountAtStake = roundCents(drop);
  const currency = order.currency;
  const summary =
    `${item.name} dropped from ${formatMoney(item.unitPrice, currency)} to ` +
    `${formatMoney(current.price, currency)}; claim ${formatMoney(amountAtStake, currency)} by ` +
    `${toDateString(adjustBy)}.`;
  const evidence = evidenceFor(order, item, current);
  const observedAt = new Date(current.observedAt).toISOString();
  const explain: PriceDropExplain = {
    rule: "price_drop",
    summary,
    paidUnitPrice: item.unitPrice,
    currentPrice: current.price,
    qty: heldQty,
    drop: amountAtStake,
    threshold: roundCents(threshold),
    windowDays,
    windowSource,
    adjustBy: adjustBy.toISOString(),
    priceSource: current.source,
    observedAt,
    dates: [
      { label: "Ordered", value: placedAt.toISOString() },
      { label: "Price observed", value: observedAt },
      { label: "Claim by", value: adjustBy.toISOString() },
    ],
    confidence: order.confMin,
    sourceQuote: evidence[0].quote,
  };

  return {
    id: findingId("price_drop", order.id, item.id),
    kind: "price_drop",
    orderId: order.id,
    lineItemId: item.id,
    amountAtStake,
    currency,
    dueAt: adjustBy.toISOString(),
    severity: severityFor(amountAtStake),
    status: "open",
    ruleVersion: PRICE_DROP_RULE_VERSION,
    summary,
    evidence,
    explain,
    simulated: current.source === "mock",
  };
}

function evaluatePriceDrop(order: NormalizedOrder, ctx: RuleContext): Finding[] {
  const priceFeed = ctx.priceFeed;
  if (!priceFeed) return [];
  if (order.merchant.policy.nonReturnable) return [];
  if (order.events.some((event) => event.type === "cancel")) return [];
  // Every finding cites the order email; an order without one cannot back a claim.
  if (order.messageIds.length === 0) return [];
  return order.lineItems
    .map((item) => evaluateLineItem(order, item, priceFeed, ctx.now))
    .filter((finding): finding is Finding => finding !== null);
}

/**
 * R3 price drop (deepdive_S14 §4, scope_features F2.3), one finding per line item with a sku.
 * Window W = policy.priceAdjustDays ?? 14 days from placedAt; skipped once now > placedAt + W, for cancelled orders,
 * non-returnable (final-sale) policies and fully returned items.
 * current = latest same-merchant, same-sku, same-currency observation at or before now.
 * drop = (unitPrice − current) × (qty − returnedQty); fires when drop ≥ max($5, 5% × unitPrice × held qty).
 * Mock-feed observations make the finding `simulated`.
 */
export const priceDropRule: Rule = {
  ...PRICE_DROP_RULE,
  evaluate: evaluatePriceDrop,
};
