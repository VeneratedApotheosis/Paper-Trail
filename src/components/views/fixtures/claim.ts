import type { ClaimViewProps } from "@/components/views/ClaimView";

// Sample props for previewing ClaimView in isolation. Standalone synthetic data
// (not from @/lib/mock) so the view stays decoupled from the data layer.
const noop = () => {};

export const claimViewFixture: ClaimViewProps = {
  finding: {
    id: "refund_overdue:o1",
    kind: "refund_overdue",
    orderId: "o1",
    amountAtStake: 98,
    currency: "USD",
    dueAt: null,
    severity: "high",
    status: "open",
    ruleVersion: "R1@1",
    summary: "Return received 16 days ago; the refund is past the 10 day window.",
    evidence: [
      {
        messageId: "m1",
        quote: "Refunds are issued within 10 business days of carrier receipt.",
      },
    ],
    explain: { refundSlaDays: 10 },
    simulated: false,
  },
  order: {
    id: "o1",
    merchant: {
      name: "Rowan and Vale",
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
    subtotal: 148,
    tax: 12.95,
    shipping: 0,
    discount: null,
    total: 160.95,
    last4: "4821",
    customerName: "Alex Song",
    lineItems: [
      { id: "li_1", name: "Merino crew sweater, oat", qty: 1, unitPrice: 98, returnedQty: 1 },
    ],
    events: [],
    messageIds: ["m1"],
    confMin: 0.9,
    needsReview: false,
  },
  draft: {
    id: "drf_1",
    findingId: "refund_overdue:o1",
    recipient: "support@rowanvale.com",
    signedName: "Alex Song",
    subject: "Refund not received, order RV-48213",
    body: [
      "Hello,",
      "",
      "I'm writing about order RV-48213 from Rowan and Vale.",
      "",
      "Return received 16 days ago; the refund is past the 10 day window.",
      "",
      'Your own confirmation stated: "Refunds are issued within 10 business days of carrier receipt."',
      "",
      "Based on this, I believe I'm owed $98.00. Could you please look into this and confirm the next steps?",
      "",
      "Thank you,",
      "Alex Song",
    ].join("\n"),
  },
  simulatedLabel: "Simulated price feed",
  onApprove: noop,
};
