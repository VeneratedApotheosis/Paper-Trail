import type { OwedViewProps } from "@/components/views/OwedView";

// Sample props for previewing OwedView in isolation. Standalone synthetic data
// (not from @/lib/mock) so views stay decoupled from the data layer.
const noop = () => {};

export const owedViewFixture: OwedViewProps = {
  summary: {
    currency: "USD",
    owedTotal: 251,
    findingCount: 3,
    claimSentCount: 1,
    claimSentTotal: 64,
    excludedCount: 1,
    excludedTotal: 50,
  },
  owedItems: [
    {
      merchant: "Rowan and Vale",
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
        evidence: [{ messageId: "m1", quote: "Refunds are issued within 10 business days of carrier receipt." }],
        explain: { refundSlaDays: 10 },
        simulated: false,
      },
    },
    {
      merchant: "Harbor Supply Co.",
      finding: {
        id: "return_deadline:o2",
        kind: "return_deadline",
        orderId: "o2",
        amountAtStake: 89,
        currency: "USD",
        dueAt: "2026-03-20T12:00:00.000Z",
        severity: "medium",
        status: "open",
        ruleVersion: "R2@1",
        summary: "Return window for the cast-iron skillet closes in 2 days.",
        evidence: [{ messageId: "m2", quote: "Items may be returned within 14 days of delivery." }],
        explain: { returnWindowDays: 14, windowAnchor: "delivery" },
        simulated: false,
      },
    },
  ],
  claimSentItems: [
    {
      merchant: "Juniper Home",
      finding: {
        id: "refund_short:o4",
        kind: "refund_short",
        orderId: "o4",
        amountAtStake: 64,
        currency: "USD",
        dueAt: null,
        severity: "medium",
        status: "drafted",
        ruleVersion: "R4@1",
        summary: "Refund was $64 short of the returned amount; claim approved and sent.",
        evidence: [{ messageId: "m4", quote: "Refund issued: $120.00 for a $184.00 return." }],
        explain: { expectedRefund: 184, actualRefund: 120 },
        simulated: false,
      },
    },
  ],
  maybeItems: [
    {
      merchant: "Atlas Outdoor",
      finding: {
        id: "price_drop:o3",
        kind: "price_drop",
        orderId: "o3",
        amountAtStake: 50,
        currency: "USD",
        dueAt: null,
        severity: "low",
        status: "open",
        ruleVersion: "R3@1",
        summary: "Possible price drop within the adjustment window.",
        evidence: [{ messageId: "m3", quote: "Price adjustments honored within 14 days of purchase." }],
        explain: { priceSource: "mock" },
        simulated: true,
      },
    },
  ],
  simulatedLabel: "Simulated price feed",
  onOpenClaim: noop,
  onOpenReview: noop,
  onBrowseLedger: noop,
  onLoadDemo: noop,
  onSetStatus: noop,
};
