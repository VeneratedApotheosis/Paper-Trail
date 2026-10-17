import type { NormalizedOrder } from "@/lib/contracts";
import type { LedgerViewProps } from "@/components/views/LedgerView";

// Sample props for previewing LedgerView in isolation. Standalone synthetic data
// (not from @/lib/mock) so views stay decoupled from the data layer.
const noop = () => {};

const orders: NormalizedOrder[] = [
  {
    id: "o1",
    merchant: {
      name: "Rowan and Vale",
      domain: "rowanvale.com",
      policy: {
        returnWindowDays: 30,
        windowAnchor: "delivery",
        refundSlaDays: 10,
        priceAdjustDays: 14,
        policySource: "email_text",
        policyQuote: null,
        nonReturnable: false,
      },
    },
    orderRef: "RV-10492",
    placedAt: "2026-02-18T15:00:00.000Z",
    currency: "USD",
    subtotal: 180,
    tax: 15,
    shipping: 0,
    discount: 0,
    total: 195,
    last4: "4242",
    customerName: "Sam Rivera",
    lineItems: [
      { id: "li1", name: "Merino crew sweater", sku: "RV-SW-01", qty: 1, unitPrice: 180, returnedQty: 0 },
    ],
    events: [
      { id: "e1", type: "shipped", at: "2026-02-19T18:00:00.000Z", messageId: "m1", conf: 0.98 },
      { id: "e2", type: "delivered", at: "2026-02-22T20:00:00.000Z", messageId: "m2", conf: 0.97 },
    ],
    messageIds: ["m0", "m1", "m2"],
    confMin: 0.95,
    needsReview: false,
  },
  {
    id: "o2",
    merchant: {
      name: "Harbor Supply Co.",
      domain: "harborsupply.co",
      policy: {
        returnWindowDays: 14,
        windowAnchor: "delivery",
        refundSlaDays: 7,
        priceAdjustDays: null,
        policySource: "default_table",
        policyQuote: null,
        nonReturnable: false,
      },
    },
    orderRef: "HS-88213",
    placedAt: "2026-03-05T12:30:00.000Z",
    currency: "USD",
    subtotal: 89,
    tax: 7,
    shipping: 6,
    discount: 0,
    total: 102,
    last4: "1881",
    customerName: "Sam Rivera",
    lineItems: [
      { id: "li2", name: "Cast-iron skillet", sku: "HS-CI-10", qty: 1, unitPrice: 89, returnedQty: 0 },
    ],
    events: [{ id: "e3", type: "shipped", at: "2026-03-06T16:00:00.000Z", messageId: "m4", conf: 0.9 }],
    messageIds: ["m3", "m4"],
    confMin: 0.62,
    needsReview: true,
  },
  {
    id: "o3",
    merchant: {
      name: "Atlas Outdoor",
      domain: "atlasoutdoor.com",
      policy: {
        returnWindowDays: 30,
        windowAnchor: "order",
        refundSlaDays: 10,
        priceAdjustDays: 14,
        policySource: "email_text",
        policyQuote: null,
        nonReturnable: false,
      },
    },
    orderRef: "AO-55017",
    placedAt: "2026-01-28T09:15:00.000Z",
    currency: "USD",
    subtotal: 240,
    tax: 20,
    shipping: 0,
    discount: 30,
    total: 230,
    last4: "7788",
    customerName: "Sam Rivera",
    lineItems: [
      { id: "li3", name: "Trail shell jacket", sku: "AO-TJ-04", qty: 1, unitPrice: 240, returnedQty: 1 },
    ],
    events: [
      { id: "e4", type: "delivered", at: "2026-02-01T19:00:00.000Z", messageId: "m6", conf: 0.96 },
      { id: "e5", type: "refund_issued", at: "2026-02-12T17:00:00.000Z", amount: 230, messageId: "m7", conf: 0.99 },
    ],
    messageIds: ["m5", "m6", "m7"],
    confMin: 0.93,
    needsReview: false,
  },
];

export const ledgerViewFixture: LedgerViewProps = {
  orders,
  onOpenOrder: noop,
  onLoadDemo: noop,
};
