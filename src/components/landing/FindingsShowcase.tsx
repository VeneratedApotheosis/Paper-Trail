import { FindingCard } from "@/components/FindingCard";
import type { Finding } from "@/lib/contracts";

// The same card the app shows on the owed page, fed with one example of each
// kind of finding it can surface. Nothing here is illustrated: it is the real
// component, so what you see is what the product actually looks like.
const SHOWCASE: { merchant: string; finding: Finding }[] = [
  {
    merchant: "Rowan and Vale",
    finding: {
      id: "sample:refund_overdue",
      kind: "refund_overdue",
      orderId: "sample-1",
      amountAtStake: 98,
      currency: "USD",
      dueAt: null,
      severity: "high",
      status: "open",
      ruleVersion: "R1@1",
      summary: "Return received 16 days ago; the refund is past the 10 day window.",
      evidence: [{ messageId: "sample-1", quote: "Refunds are issued within 10 business days of carrier receipt." }],
      explain: { slaDays: 10, confidence: 0.88 },
      simulated: false,
    },
  },
  {
    merchant: "Harbor Supply Co.",
    finding: {
      id: "sample:return_deadline",
      kind: "return_deadline",
      orderId: "sample-2",
      amountAtStake: 89,
      currency: "USD",
      dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      severity: "medium",
      status: "open",
      ruleVersion: "R2@1",
      summary: "Return window for the cast-iron skillet closes in 2 days.",
      evidence: [{ messageId: "sample-2", quote: "Items may be returned within 14 days of delivery." }],
      explain: { windowDays: 14, confidence: 0.95 },
      simulated: false,
    },
  },
  {
    merchant: "Juniper Home",
    finding: {
      id: "sample:refund_short",
      kind: "refund_short",
      orderId: "sample-3",
      amountAtStake: 64,
      currency: "USD",
      dueAt: null,
      severity: "medium",
      status: "open",
      ruleVersion: "R4@1",
      summary: "Refund was $64 short of the returned amount.",
      evidence: [{ messageId: "sample-3", quote: "Refund issued: $120.00 for a $184.00 return." }],
      explain: { expectedAmount: 184, refundedAmount: 120, confidence: 0.92 },
      simulated: false,
    },
  },
  {
    merchant: "Atlas Outdoor",
    finding: {
      id: "sample:price_drop",
      kind: "price_drop",
      orderId: "sample-4",
      amountAtStake: 50,
      currency: "USD",
      dueAt: null,
      severity: "low",
      status: "open",
      ruleVersion: "R3@1",
      summary: "Price dropped within the 14 day adjustment window.",
      evidence: [{ messageId: "sample-4", quote: "Price adjustments honored within 14 days of purchase." }],
      explain: { priceSource: "mock" },
      simulated: true,
    },
  },
];

export function FindingsShowcase({ onOpenApp }: { onOpenApp: () => void }) {
  return (
    <section id="findings" className="mx-auto max-w-ledger px-5 py-16 xl:max-w-5xl xl:px-0 xl:py-24">
      <p className="eyebrow mb-3">What it finds</p>
      <h2 className="max-w-xl font-serif text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        Four kinds of money people forget to chase.
      </h2>
      <p className="mt-3 max-w-md text-base text-ink-muted">
        Every card opens to the exact line from your email and the math behind the number.
        Nothing here is a guess from the model: the amount always comes from a rule.
      </p>
      <div className="mt-10 space-y-4" inert>
        {SHOWCASE.map(({ merchant, finding }) => (
          <FindingCard
            key={finding.id}
            finding={finding}
            merchant={merchant}
            simulatedLabel="Simulated price feed"
            onDraftClaim={onOpenApp}
          />
        ))}
      </div>
    </section>
  );
}
