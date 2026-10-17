import type { NormalizedOrder } from "@/lib/contracts";
import type { ReviewViewProps } from "@/components/views/ReviewView";

// Sample props for previewing ReviewView in isolation. Standalone synthetic data
// (not from @/lib/mock) so views stay decoupled from the data layer. Both orders
// sit below the confidence bar, which is why they land in the review queue.
const noop = () => {};

const items: NormalizedOrder[] = [
  {
    id: "ord_review_1",
    merchant: {
      name: "Juniper Goods",
      domain: "junipergoods.com",
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
    orderRef: "JG-20481",
    placedAt: "2026-03-09T14:00:00.000Z",
    currency: "USD",
    subtotal: 74,
    tax: 6,
    shipping: 0,
    discount: 0,
    total: 80,
    last4: "3310",
    customerName: "Sam Rivera",
    lineItems: [
      { id: "li_r1", name: "Linen table runner", sku: "JG-LR-02", qty: 1, unitPrice: 74, returnedQty: 0 },
    ],
    events: [],
    messageIds: ["mr1"],
    confMin: 0.61,
    needsReview: true,
  },
  {
    id: "ord_review_2",
    merchant: {
      name: "Beacon Coffee",
      domain: null,
      policy: {
        returnWindowDays: null,
        windowAnchor: null,
        refundSlaDays: null,
        priceAdjustDays: null,
        policySource: null,
        policyQuote: null,
        nonReturnable: false,
      },
    },
    orderRef: null,
    placedAt: "2026-03-11T09:30:00.000Z",
    currency: "USD",
    subtotal: 48,
    tax: 4,
    shipping: 5,
    discount: 0,
    total: 57,
    last4: null,
    customerName: null,
    lineItems: [
      { id: "li_r2", name: "Single-origin subscription", qty: 2, unitPrice: 24, returnedQty: 0 },
    ],
    events: [],
    messageIds: ["mr2", "mr3"],
    confMin: 0.58,
    needsReview: true,
  },
];

export const reviewViewFixture: ReviewViewProps = {
  items,
  onConfirm: noop,
  onEditField: noop,
};
