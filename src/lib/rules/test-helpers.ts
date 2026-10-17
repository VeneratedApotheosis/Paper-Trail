import type {
  MerchantPolicy,
  NormalizedOrder,
  OrderEvent,
  OrderEventType,
} from "@/lib/contracts";

/** Synthetic test fixtures for rules tests. All merchants and orders are fictional. */

export function makePolicy(overrides: Partial<MerchantPolicy> = {}): MerchantPolicy {
  return {
    returnWindowDays: 30,
    windowAnchor: "delivery",
    refundSlaDays: null,
    priceAdjustDays: null,
    policySource: null,
    policyQuote: null,
    nonReturnable: false,
    ...overrides,
  };
}

export function makeEvent(
  type: OrderEventType,
  at: string,
  overrides: Partial<OrderEvent> = {},
): OrderEvent {
  return {
    id: `evt-${type}-${at}`,
    type,
    at,
    messageId: `msg-${type}-${at.slice(0, 10)}`,
    conf: 0.95,
    ...overrides,
  };
}

/**
 * Default order: jacket 1 × 80 + socks 2 × 10 = subtotal 100, tax 8, shipping 5, total 113 USD.
 * Line item ids: "li-jacket", "li-socks".
 */
export function makeOrder(overrides: Partial<NormalizedOrder> = {}): NormalizedOrder {
  return {
    id: "ord-1",
    merchant: {
      name: "Northwind Outfitters",
      domain: "northwind.example",
      policy: makePolicy(),
    },
    orderRef: "NW-1001",
    placedAt: "2026-09-01T10:00:00.000Z",
    currency: "USD",
    subtotal: 100,
    tax: 8,
    shipping: 5,
    discount: null,
    total: 113,
    last4: "4242",
    customerName: "Sam Synthetic",
    lineItems: [
      { id: "li-jacket", name: "Rain Jacket", sku: "NW-RJ-1", qty: 1, unitPrice: 80, returnedQty: 0 },
      { id: "li-socks", name: "Wool Socks", sku: "NW-WS-2", qty: 2, unitPrice: 10, returnedQty: 0 },
    ],
    events: [],
    messageIds: ["msg-order"],
    confMin: 0.95,
    needsReview: false,
    ...overrides,
  };
}
