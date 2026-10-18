import type { NormalizedOrder } from "@/lib/contracts";
import type { LedgerViewProps } from "@/components/views/LedgerView";

// Sample props with 120 synthetic stores (and ~200 purchases) to preview the store
// dropdown at real-inbox scale. Deterministic: no randomness, no Date.now().
const noop = () => {};

const FIRST = ["Rowan", "Harbor", "Atlas", "Cedar", "Juniper", "Ember", "Willow", "Summit", "Marlow", "Ironwood"];
const SECOND = ["and Vale", "Supply Co.", "Outdoor", "Goods", "Mercantile", "Home", "Studio", "Provisions", "Works", "Market", "Cycles", "Garden"];

export const manyStoreNames: string[] = FIRST.flatMap((first) =>
  SECOND.map((second) => `${first} ${second}`),
);

function orderFor(storeIndex: number, copy: number): NormalizedOrder {
  const name = manyStoreNames[storeIndex];
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const n = storeIndex * 2 + copy;
  const placedAt = new Date(Date.UTC(2026, 0, 1 + (n % 120), 12)).toISOString();
  const total = 20 + ((n * 37) % 180);
  return {
    id: `many-${n}`,
    merchant: {
      name,
      domain: `${slug}.example`,
      policy: {
        returnWindowDays: 30,
        windowAnchor: "delivery",
        refundSlaDays: 10,
        priceAdjustDays: null,
        policySource: "default_table",
        policyQuote: null,
        nonReturnable: false,
      },
    },
    orderRef: `SYN-${10000 + n}`,
    placedAt,
    currency: "USD",
    subtotal: total,
    tax: 0,
    shipping: 0,
    discount: 0,
    total,
    last4: "4242",
    customerName: "Sam Rivera",
    lineItems: [
      { id: `many-li-${n}`, name: "Synthetic item", sku: `SYN-${n}`, qty: 1, unitPrice: total, returnedQty: 0 },
    ],
    events:
      n % 3 === 0
        ? [{ id: `many-e-${n}`, type: "delivered", at: placedAt, messageId: `many-m-${n}`, conf: 0.97 }]
        : [],
    messageIds: [`many-m-${n}`],
    confMin: 0.95,
    needsReview: false,
  };
}

const orders: NormalizedOrder[] = manyStoreNames.flatMap((_, storeIndex) =>
  // Every third store has a second purchase, so counts differ between stores.
  storeIndex % 3 === 0 ? [orderFor(storeIndex, 0), orderFor(storeIndex, 1)] : [orderFor(storeIndex, 0)],
);

export const ledgerManyStoresFixture: LedgerViewProps = {
  orders,
  onOpenOrder: noop,
  onLoadDemo: noop,
};