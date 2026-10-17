// Synthetic demo data (SYNTHETIC — not real purchases). Shape matches the UI
// contract in src/lib/types.ts. Screens import from here until the real API
// (owned by backend issues) lands; swapping the source keeps components intact.
import type {
  AuditEntry,
  Draft,
  Finding,
  Order,
  OwedSummary,
} from "@/lib/types";
import { CONFIDENCE_THRESHOLD } from "@/lib/format";

export const DEMO_LABEL = "Demo data — synthetic";
export const SIMULATED_PRICE_LABEL = "Simulated price feed";

// Anchor all demo dates to a fixed "now" so countdowns are stable in the demo.
const NOW = new Date("2026-03-18T12:00:00Z");
const day = 24 * 60 * 60 * 1000;
const iso = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * day).toISOString();

export const DEMO_NOW = NOW.toISOString();

export const orders: Order[] = [
  {
    id: "ord_1001",
    merchantName: "Rowan & Vale",
    merchantDomain: "rowanvale.com",
    orderRef: "RV-48213",
    placedAt: iso(-26),
    currency: "USD",
    subtotal: 148.0,
    tax: 12.95,
    shipping: 0,
    total: 160.95,
    last4: "4821",
    status: "return_started",
    confMin: 0.92,
    lineItems: [
      { id: "li_1", name: "Merino crew sweater, oat", qty: 1, unitPrice: 98.0, returnedQty: 1 },
      { id: "li_2", name: "Wool-blend beanie", qty: 1, unitPrice: 50.0, returnedQty: 0 },
    ],
    events: [
      { id: "ev_1", type: "ordered", at: iso(-26), source: email("Order confirmed — RV-48213", "rowanvale.com", -26) },
      { id: "ev_2", type: "shipped", at: iso(-24), source: email("Your order shipped", "rowanvale.com", -24) },
      { id: "ev_3", type: "delivered", at: iso(-21), source: email("Delivered", "rowanvale.com", -21) },
      {
        id: "ev_4",
        type: "return_started",
        at: iso(-16),
        amount: 98.0,
        conf: 0.9,
        evidenceQuote: "We've received your return request for the Merino crew sweater. Refunds are issued within 10 business days of carrier receipt.",
        source: email("Return started — RV-48213", "rowanvale.com", -16),
      },
    ],
    source: email("Order confirmed — RV-48213", "rowanvale.com", -26),
  },
  {
    id: "ord_1002",
    merchantName: "Harbor Supply Co.",
    merchantDomain: "harborsupply.com",
    orderRef: "HS-90217",
    placedAt: iso(-9),
    currency: "USD",
    subtotal: 219.0,
    tax: 18.62,
    shipping: 8.0,
    total: 245.62,
    last4: "4821",
    status: "delivered",
    confMin: 0.88,
    lineItems: [
      { id: "li_3", name: "Cast-iron skillet, 12in", qty: 1, unitPrice: 89.0, returnedQty: 0 },
      { id: "li_4", name: "Enamel dutch oven, 5.5qt", qty: 1, unitPrice: 130.0, returnedQty: 0 },
    ],
    events: [
      { id: "ev_5", type: "ordered", at: iso(-9), source: email("Thanks for your order", "harborsupply.com", -9) },
      { id: "ev_6", type: "delivered", at: iso(-4), source: email("Your package arrived", "harborsupply.com", -4) },
    ],
    source: email("Thanks for your order", "harborsupply.com", -9),
  },
  {
    id: "ord_1003",
    merchantName: "Field Notes Coffee",
    merchantDomain: "fieldnotescoffee.com",
    orderRef: "FN-3391",
    placedAt: iso(-13),
    currency: "USD",
    subtotal: 64.0,
    tax: 5.44,
    shipping: 0,
    total: 69.44,
    last4: "1190",
    status: "refunded",
    confMin: 0.95,
    lineItems: [
      { id: "li_5", name: "Single-origin subscription, 2 bags", qty: 2, unitPrice: 32.0, returnedQty: 2 },
    ],
    events: [
      { id: "ev_7", type: "ordered", at: iso(-13), source: email("Order received", "fieldnotescoffee.com", -13) },
      {
        id: "ev_8",
        type: "refund_issued",
        at: iso(-5),
        amount: 44.0,
        conf: 0.96,
        evidenceQuote: "We've refunded $44.00 to your card ending 1190 for the damaged bags.",
        source: email("Your refund was processed", "fieldnotescoffee.com", -5),
      },
    ],
    source: email("Order received", "fieldnotescoffee.com", -13),
  },
  {
    id: "ord_1004",
    merchantName: "Atlas Outdoor",
    merchantDomain: "atlasoutdoor.com",
    orderRef: "AO-77510",
    placedAt: iso(-6),
    currency: "USD",
    subtotal: 220.0,
    tax: 0,
    shipping: 0,
    total: 220.0,
    last4: "4821",
    status: "delivered",
    confMin: 0.61, // below threshold -> needs review
    lineItems: [
      { id: "li_6", name: "Insulated hooded parka", qty: 1, unitPrice: 220.0, returnedQty: 0 },
    ],
    events: [
      { id: "ev_9", type: "ordered", at: iso(-6), source: email("Fwd: your Atlas order", "mail.example.com", -6) },
    ],
    source: email("Fwd: your Atlas order", "mail.example.com", -6),
  },
];

export const findings: Finding[] = [
  {
    id: "fnd_1",
    orderId: "ord_1001",
    merchantName: "Rowan & Vale",
    kind: "refund_overdue",
    amountAtStake: 98.0,
    currency: "USD",
    dueAt: iso(-2), // refund SLA passed 2 days ago
    severity: "high",
    status: "open",
    ruleVersion: "r1.0.0",
    explain: {
      rule: "refund_overdue",
      summary: "Your return was received 16 days ago but the $98.00 refund hasn't posted.",
      dates: [
        { label: "Return received", value: iso(-16) },
        { label: "Refund promised by", value: iso(-2) },
      ],
      sourceQuote: "Refunds are issued within 10 business days of carrier receipt.",
      confidence: 0.9,
    },
  },
  {
    id: "fnd_2",
    orderId: "ord_1002",
    merchantName: "Harbor Supply Co.",
    kind: "return_deadline",
    amountAtStake: 89.0,
    currency: "USD",
    dueAt: iso(2), // window closes in 2 days
    severity: "medium",
    status: "open",
    ruleVersion: "r1.0.0",
    explain: {
      rule: "return_deadline",
      summary: "Return window for the cast-iron skillet closes in 2 days.",
      dates: [
        { label: "Delivered", value: iso(-4) },
        { label: "Window closes", value: iso(2) },
      ],
      sourceQuote: "Items may be returned within 14 days of delivery for a full refund.",
      confidence: 0.86,
    },
  },
  {
    id: "fnd_3",
    orderId: "ord_1002",
    merchantName: "Harbor Supply Co.",
    kind: "price_drop",
    amountAtStake: 26.0,
    currency: "USD",
    dueAt: iso(5),
    severity: "low",
    status: "open",
    ruleVersion: "r1.0.0",
    explain: {
      rule: "price_drop",
      summary: "The enamel dutch oven dropped $26.00 within the price-adjustment window.",
      dates: [
        { label: "Purchased at", value: iso(-9) },
        { label: "Price-match until", value: iso(5) },
      ],
      sourceQuote: "Price adjustments honored within 14 days of purchase.",
      confidence: 0.81,
      priceSource: "mock",
    },
  },
  {
    id: "fnd_4",
    orderId: "ord_1003",
    merchantName: "Field Notes Coffee",
    kind: "refund_short",
    amountAtStake: 20.0,
    currency: "USD",
    severity: "medium",
    status: "open",
    ruleVersion: "r1.0.0",
    explain: {
      rule: "refund_short",
      summary: "You were refunded $44.00 but the two bags totalled $64.00 — $20.00 short.",
      dates: [{ label: "Refund issued", value: iso(-5) }],
      sourceQuote: "We've refunded $44.00 to your card ending 1190 for the damaged bags.",
      confidence: 0.94,
    },
  },
];

export const drafts: Draft[] = [
  {
    id: "drf_1",
    findingId: "fnd_1",
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

export function getOrder(id: string): Order | undefined {
  return orders.find((o) => o.id === id);
}

export function getFinding(id: string): Finding | undefined {
  return findings.find((f) => f.id === id);
}

export function getDraftForFinding(findingId: string): Draft | undefined {
  return drafts.find((d) => d.findingId === findingId);
}

// Owed total excludes needs-review orders (confMin < threshold) until confirmed.
export function owedSummary(): OwedSummary {
  const included = findings.filter((f) => {
    const order = getOrder(f.orderId);
    return (
      f.status === "open" &&
      f.explain.confidence >= CONFIDENCE_THRESHOLD &&
      order !== undefined &&
      order.confMin >= CONFIDENCE_THRESHOLD
    );
  });
  const excluded = findings.filter((f) => !included.includes(f));
  return {
    currency: "USD",
    owedTotal: included.reduce((sum, f) => sum + f.amountAtStake, 0),
    findingCount: included.length,
    excludedCount: excluded.length,
    excludedTotal: excluded.reduce((sum, f) => sum + f.amountAtStake, 0),
  };
}

function email(subject: string, fromDomain: string, offsetDays: number) {
  return { subject, fromDomain, receivedAt: iso(offsetDays) };
}

function pretty(offsetDays: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
  }).format(new Date(NOW.getTime() + offsetDays * day));
}
