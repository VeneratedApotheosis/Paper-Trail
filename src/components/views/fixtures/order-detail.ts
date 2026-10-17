import type { OrderDetailViewProps } from "@/components/views/OrderDetailView";

// Sample props for previewing OrderDetailView in isolation. Standalone synthetic
// data (not from @/lib/mock) so the view stays decoupled from the data layer.
const noop = () => {};

export const orderDetailViewFixture: OrderDetailViewProps = {
  order: {
    id: "ord_sample",
    merchant: {
      name: "Rowan & Vale",
      domain: "rowanvale.com",
      policy: {
        returnWindowDays: null,
        windowAnchor: null,
        refundSlaDays: 10,
        priceAdjustDays: null,
        policySource: "email_text",
        policyQuote: "Refunds are issued within 10 business days of carrier receipt.",
        nonReturnable: false,
      },
    },
    orderRef: "RV-48213",
    placedAt: "2026-02-20T12:00:00.000Z",
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
      { id: "ev_2", type: "shipped", at: "2026-02-22T12:00:00.000Z", messageId: "msg_rv_2", conf: 0.95 },
      { id: "ev_3", type: "delivered", at: "2026-02-25T12:00:00.000Z", messageId: "msg_rv_3", conf: 0.93 },
      {
        id: "ev_4",
        type: "return_received",
        at: "2026-03-02T12:00:00.000Z",
        amount: 98.0,
        messageId: "msg_rv_4",
        conf: 0.9,
        evidence:
          "We've received your return for the Merino crew sweater. Refunds are issued within 10 business days of carrier receipt.",
        lineItemIds: ["li_1"],
      },
    ],
    messageIds: ["msg_rv_1", "msg_rv_2", "msg_rv_3", "msg_rv_4"],
    confMin: 0.9,
    needsReview: false,
  },
  findings: [
    {
      id: "refund_overdue:ord_sample",
      kind: "refund_overdue",
      orderId: "ord_sample",
      lineItemId: "li_1",
      amountAtStake: 98.0,
      currency: "USD",
      dueAt: "2026-03-16T12:00:00.000Z",
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
      explain: { refundSlaDays: 10, policySource: "email_text", confidence: 0.9 },
      simulated: false,
    },
  ],
  onBack: noop,
};
