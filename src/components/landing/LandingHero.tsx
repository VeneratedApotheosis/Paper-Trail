import { HeroCard } from "@/components/HeroCard";
import { OwedBreakdown } from "@/components/OwedBreakdown";
import { Chip } from "@/components/ui/Chip";
import { groupByKind } from "@/components/owedGroups";
import type { Finding } from "@/lib/contracts";

// The hero sample: the same three rule kinds the real app leads with (refund
// overdue, return window closing, price drop), sized so the card reads the way
// a real first week of findings would. Kept local to the hero, not the shared
// fixtures (those are for isolated view previews, not marketing copy).
const SAMPLE_FINDINGS: { merchant: string; finding: Finding }[] = [
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
      explain: {},
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
      dueAt: null,
      severity: "medium",
      status: "open",
      ruleVersion: "R2@1",
      summary: "Return window for the cast-iron skillet closes in 2 days.",
      evidence: [{ messageId: "sample-2", quote: "Items may be returned within 14 days of delivery." }],
      explain: {},
      simulated: false,
    },
  },
  {
    merchant: "Atlas Outdoor",
    finding: {
      id: "sample:price_drop",
      kind: "price_drop",
      orderId: "sample-3",
      amountAtStake: 64,
      currency: "USD",
      dueAt: null,
      severity: "low",
      status: "open",
      ruleVersion: "R3@1",
      summary: "Price dropped within the adjustment window.",
      evidence: [{ messageId: "sample-3", quote: "Price adjustments honored within 14 days of purchase." }],
      explain: {},
      simulated: true,
    },
  },
];

const SAMPLE_TOTAL = SAMPLE_FINDINGS.reduce((sum, { finding }) => sum + finding.amountAtStake, 0);

export function LandingHero({
  onOpenApp,
  onConnectGmail,
  onTryDemo,
}: {
  onOpenApp: () => void;
  onConnectGmail?: () => void;
  onTryDemo?: () => void;
}) {
  const groups = groupByKind(SAMPLE_FINDINGS, "USD");

  return (
    <section id="top" className="mx-auto max-w-ledger px-5 pb-16 pt-12 xl:max-w-5xl xl:px-0 xl:pb-24 xl:pt-20">
      <div className="grid items-center gap-10 xl:grid-cols-[1fr_1fr] xl:gap-16">
        <div>
          <p className="eyebrow mb-4">Receipts in, money back out</p>
          <h1 className="font-serif text-4xl font-semibold leading-[1.05] tracking-tight text-ink sm:text-5xl">
            The money is already sitting in your inbox.
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-ink-muted">
            PaperTrail reads your receipt emails and turns every purchase into a ledger row, then
            finds the refunds that are late, the return windows that are closing and the prices
            that dropped after you bought. Every number comes with the line from your email that
            proves it.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={onTryDemo ?? onOpenApp}
              className="neu-accent inline-flex min-h-[44px] items-center justify-center rounded-lg px-6 text-sm font-bold sm:w-auto"
            >
              Try the demo
            </button>
            <button
              type="button"
              onClick={onConnectGmail ?? onOpenApp}
              className="neu-raised-sm inline-flex min-h-[44px] items-center justify-center rounded-lg px-6 text-sm font-bold text-teal-deep sm:w-auto"
            >
              Log in
            </button>
            <a
              href="#how-it-works"
              className="neu-raised-sm inline-flex min-h-[44px] items-center justify-center rounded-lg px-6 text-sm font-bold text-teal-deep sm:w-auto"
            >
              See how it works
            </a>
          </div>
          <p className="mt-6 flex items-start gap-2.5 text-sm text-ink-muted">
            <span aria-hidden className="neu-inset mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full text-xs font-bold text-teal-deep">
              ✓
            </span>
            Gmail access is read-only. PaperTrail never sends email or moves money.
          </p>
        </div>

        <div className="relative" inert>
          <div className="absolute -top-3 right-4 z-10">
            <Chip tone="neutral">Sample data</Chip>
          </div>
          <HeroCard total={SAMPLE_TOTAL} currency="USD" count={SAMPLE_FINDINGS.length} onDraftClaims={onOpenApp} onReview={onOpenApp}>
            <OwedBreakdown groups={groups} currency="USD" />
          </HeroCard>
        </div>
      </div>
    </section>
  );
}
