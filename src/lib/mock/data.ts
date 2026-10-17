// Synthetic demo data (SYNTHETIC — not real purchases). Shapes are the canonical
// contracts from "@/lib/contracts" (#29). Screens import from here until the real
// API (backend issues) lands; swapping the source keeps components intact.
import type { Finding, MerchantPolicy, NormalizedOrder } from "@/lib/contracts";
import type { AuditEntry, Draft, OwedSummary } from "@/lib/types";
import { computeOwedSummary } from "@/lib/view";

export const DEMO_LABEL = "Demo data — synthetic";
export const SIMULATED_PRICE_LABEL = "Simulated price feed";

// Anchor all demo dates to a fixed "now" so countdowns are stable in the demo.
const NOW = new Date("2026-03-18T12:00:00Z");
const day = 24 * 60 * 60 * 1000;
const iso = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * day).toISOString();

export const DEMO_NOW = NOW.toISOString();

function policy(p: Partial<MerchantPolicy>): MerchantPolicy {
  return {
    returnWindowDays: null,
    windowAnchor: null,
    refundSlaDays: null,
    priceAdjustDays: null,
    policySource: null,
    policyQuote: null,
    nonReturnable: false,
    ...p,
  };
}

export const orders: NormalizedOrder[] = [
  {
    id: "ord_1001",
    merchant: {
      name: "Rowan & Vale",
      domain: "rowanvale.com",
      policy: policy({
        refundSlaDays: 10,
        policySource: "email_text",
        policyQuote: "Refunds are issued within 10 business days of carrier receipt.",
      }),
    },
    orderRef: "RV-48213",
    placedAt: iso(-26),
    currency: "USD",
    subtotal: 148.0,
    tax: 12.95,
    shipping: 0,
    discount: null,
    total: 160.95,
    last4: "4821",
    customerName: "Alex Song",
    lineItems: [
      { id: "li_1", name: "Merino crew sweater, oat", qty: 1, unitPrice: 98.0, returnedQty: 1 },
      { id: "li_2", name: "Wool-blend beanie", qty: 1, unitPrice: 50.0, returnedQty: 0 },
    ],
    events: [
      { id: "ev_2", type: "shipped", at: iso(-24), messageId: "msg_rv_2", conf: 0.95 },
      { id: "ev_3", type: "delivered", at: iso(-21), messageId: "msg_rv_3", conf: 0.93 },
      {
        id: "ev_4",
        type: "return_received",
        at: iso(-16),
        amount: 98.0,
        messageId: "msg_rv_4",
        conf: 0.9,
        evidence: "We've received your return for the Merino crew sweater. Refunds are issued within 10 business days of carrier receipt.",
        lineItemIds: ["li_1"],
      },
    ],
    messageIds: ["msg_rv_1", "msg_rv_2", "msg_rv_3", "msg_rv_4"],
    confMin: 0.9,
    needsReview: false,
  },
  {
    id: "ord_1002",
    merchant: {
      name: "Harbor Supply Co.",
      domain: "harborsupply.com",
      policy: policy({
        returnWindowDays: 14,
        windowAnchor: "delivery",
        priceAdjustDays: 14,
        policySource: "email_text",
        policyQuote: "Items may be returned within 14 days of delivery for a full refund.",
      }),
    },
    orderRef: "HS-90217",
    placedAt: iso(-9),
    currency: "USD",
    subtotal: 219.0,
    tax: 18.62,
    shipping: 8.0,
    discount: null,
    total: 245.62,
    last4: "4821",
    customerName: "Alex Song",
    lineItems: [
      { id: "li_3", name: "Cast-iron skillet, 12in", qty: 1, unitPrice: 89.0, returnedQty: 0 },
      { id: "li_4", name: "Enamel dutch oven, 5.5qt", qty: 1, unitPrice: 130.0, returnedQty: 0 },
    ],
    events: [{ id: "ev_6", type: "delivered", at: iso(-4), messageId: "msg_hs_2", conf: 0.88 }],
    messageIds: ["msg_hs_1", "msg_hs_2"],
    confMin: 0.86,
    needsReview: false,
  },
  {
    id: "ord_1003",
    merchant: {
      name: "Field Notes Coffee",
      domain: "fieldnotescoffee.com",
      policy: policy({ refundSlaDays: 7, policySource: "default_table" }),
    },
    orderRef: "FN-3391",
    placedAt: iso(-13),
    currency: "USD",
    subtotal: 64.0,
    tax: 5.44,
    shipping: 0,
    discount: null,
    total: 69.44,
    last4: "1190",
    customerName: "Alex Song",
    lineItems: [
      { id: "li_5", name: "Single-origin subscription, 2 bags", qty: 2, unitPrice: 32.0, returnedQty: 2 },
    ],
    events: [
      {
        id: "ev_8",
        type: "refund_issued",
        at: iso(-5),
        amount: 44.0,
        messageId: "msg_fn_2",
        conf: 0.96,
        evidence: "We've refunded $44.00 to your card ending 1190 for the damaged bags.",
      },
    ],
    messageIds: ["msg_fn_1", "msg_fn_2"],
    confMin: 0.94,
    needsReview: false,
  },
  {
    id: "ord_1004",
    merchant: {
      name: "Atlas Outdoor",
      domain: "atlasoutdoor.com",
      policy: policy({ returnWindowDays: 30, windowAnchor: "delivery", policySource: "default_table" }),
    },
    orderRef: "AO-77510",
    placedAt: iso(-6),
    currency: "USD",
    subtotal: 220.0,
    tax: 0,
    shipping: 0,
    discount: null,
    total: 220.0,
    last4: null,
    customerName: null,
    lineItems: [{ id: "li_6", name: "Insulated hooded parka", qty: 1, unitPrice: 220.0, returnedQty: 0 }],
    events: [],
    messageIds: ["msg_ao_1"],
    confMin: 0.61, // below threshold -> needs review
    needsReview: true,
  },
];

export const findings: Finding[] = [
  {
    id: "refund_overdue:ord_1001",
    kind: "refund_overdue",
    orderId: "ord_1001",
    lineItemId: "li_1",
    amountAtStake: 98.0,
    currency: "USD",
    dueAt: iso(-2),
    severity: "high",
    status: "open",
    ruleVersion: "R1@1",
    summary: "Return received 16 days ago; the $98.00 refund is past the 10-day window.",
    evidence: [
      {
        messageId: "msg_rv_4",
        quote: "Refunds are issued within 10 business days of carrier receipt.",
      },
    ],
    explain: {
      returnReceived: iso(-16),
      refundPromisedBy: iso(-2),
      refundSlaDays: 10,
      policySource: "email_text",
      confidence: 0.9,
    },
    simulated: false,
  },
  {
    id: "return_deadline:ord_1002:li_3",
    kind: "return_deadline",
    orderId: "ord_1002",
    lineItemId: "li_3",
    amountAtStake: 89.0,
    currency: "USD",
    dueAt: iso(2),
    severity: "medium",
    status: "open",
    ruleVersion: "R2@1",
    summary: "Return window for the cast-iron skillet closes in 2 days.",
    evidence: [
      {
        messageId: "msg_hs_2",
        quote: "Items may be returned within 14 days of delivery for a full refund.",
      },
    ],
    explain: {
      delivered: iso(-4),
      windowCloses: iso(2),
      returnWindowDays: 14,
      windowAnchor: "delivery",
      confidence: 0.86,
    },
    simulated: false,
  },
  {
    id: "price_drop:ord_1002:li_4",
    kind: "price_drop",
    orderId: "ord_1002",
    lineItemId: "li_4",
    amountAtStake: 26.0,
    currency: "USD",
    dueAt: iso(5),
    severity: "low",
    status: "open",
    ruleVersion: "R3@1",
    summary: "The enamel dutch oven dropped $26.00 within the price-adjustment window.",
    evidence: [
      {
        messageId: "msg_hs_2",
        quote: "Price adjustments honored within 14 days of purchase.",
      },
    ],
    explain: {
      purchasedAt: iso(-9),
      priceMatchUntil: iso(5),
      paidPrice: 130.0,
      currentPrice: 104.0,
      priceSource: "mock",
      confidence: 0.81,
    },
    simulated: true, // mock price feed -> UI must label "simulated"
  },
  {
    id: "refund_short:ord_1003",
    kind: "refund_short",
    orderId: "ord_1003",
    amountAtStake: 20.0,
    currency: "USD",
    dueAt: null,
    severity: "medium",
    status: "open",
    ruleVersion: "R1@1",
    summary: "Refunded $44.00 but the two bags totalled $64.00 — $20.00 short.",
    evidence: [
      {
        messageId: "msg_fn_2",
        quote: "We've refunded $44.00 to your card ending 1190 for the damaged bags.",
      },
    ],
    explain: {
      expected: 64.0,
      received: 44.0,
      delta: 20.0,
      confidence: 0.94,
    },
    simulated: false,
  },
];

export const drafts: Draft[] = [
  {
    id: "drf_1",
    findingId: "refund_overdue:ord_1001",
    recipient: "support@rowanvale.com",
    signedName: "Alex Song",
    subject: "Refund not received — order RV-48213",
    body: `Hello,\n\nI'm writing about order RV-48213, placed on ${pretty(-26)}. My return was received on ${pretty(-16)}, and your confirmation stated: "Refunds are issued within 10 business days of carrier receipt."\n\nAs of today the $98.00 refund for the Merino crew sweater has not appeared on my card ending 4821. It is now past the stated window. Could you confirm the refund has been issued and share the expected posting date?\n\nThank you,\nAlex Song`,
  },
];

export const auditLog: AuditEntry[] = [
  { id: "aud_1", at: iso(-0.02), type: "sync_complete", detail: "Sync finished: 4 orders, 4 findings" },
  { id: "aud_2", at: iso(-0.05), type: "llm_call", detail: "Extract fields — order RV-48213", redactedTokenCount: 3, model: "gpt-4o-mini", cost: 0.0021 },
  { id: "aud_3", at: iso(-0.06), type: "llm_call", detail: "Classify — 18 messages", redactedTokenCount: 24, model: "gpt-4o-mini", cost: 0.0039 },
  { id: "aud_4", at: iso(-0.08), type: "gmail_fetch", detail: "Fetched 18 messages (query: newer_than:90d category:purchases)" },
  { id: "aud_5", at: iso(-0.08), type: "sync_start", detail: "Sync started" },
];

export function getOrder(id: string): NormalizedOrder | undefined {
  return orders.find((o) => o.id === id);
}

export function getFinding(id: string): Finding | undefined {
  return findings.find((f) => f.id === id);
}

export function getDraftForFinding(findingId: string): Draft | undefined {
  return drafts.find((d) => d.findingId === findingId);
}

export function owedSummary(): OwedSummary {
  return computeOwedSummary(findings, orders);
}

function pretty(offsetDays: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
  }).format(new Date(NOW.getTime() + offsetDays * day));
}
