"use client";

import type { Finding } from "@/lib/contracts";
import type { OwedSummary } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { HeroCard } from "@/components/HeroCard";
import { FindingCard } from "@/components/FindingCard";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/states";
import { formatMoney } from "@/lib/format";

// Props-only view for the hero "You're owed $X" screen. All data arrives as
// props (typed via @/lib/contracts) and every action is a callback, so the page
// wrapper (and later ui-wiring) owns data + navigation. No fetch, no @/lib/api.
export interface OwedFindingItem {
  finding: Finding;
  merchant: string;
}

export interface OwedViewProps {
  summary: OwedSummary;
  owedItems: OwedFindingItem[];
  maybeItems: OwedFindingItem[];
  simulatedLabel: string;
  onOpenClaim: (findingId: string) => void;
  onOpenReview: () => void;
  onBrowseLedger: () => void;
  onLoadDemo?: () => void;
}

export function OwedView({
  summary,
  owedItems,
  maybeItems,
  simulatedLabel,
  onOpenClaim,
  onOpenReview,
  onBrowseLedger,
  onLoadDemo,
}: OwedViewProps) {
  const isEmpty = summary.owedTotal === 0 && owedItems.length === 0 && maybeItems.length === 0;

  if (isEmpty) {
    return (
      <AppShell>
        <EmptyState
          title="Nothing owed right now"
          actions={
            <>
              {onLoadDemo ? (
                <Button type="button" onClick={onLoadDemo}>
                  Load demo data
                </Button>
              ) : null}
              <Button type="button" variant="secondary" onClick={onBrowseLedger}>
                Browse the ledger
              </Button>
            </>
          }
        >
          We went through your receipts and found no overdue refunds, closing
          return windows, or price drops. You are all squared up. We will flag
          anything the moment it appears.
        </EmptyState>
      </AppShell>
    );
  }

  function scrollToFindings() {
    document.getElementById("findings")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <AppShell>
      <div className="space-y-8">
        <h1 className="sr-only">
          You are owed {formatMoney(summary.owedTotal, summary.currency)}
        </h1>

        <HeroCard
          total={summary.owedTotal}
          currency={summary.currency}
          count={summary.findingCount}
          onDraftClaims={scrollToFindings}
          onReview={onOpenReview}
        />

        {owedItems.length > 0 ? (
          <section id="findings" aria-label="Open findings" className="space-y-4">
            <h2 className="font-serif text-2xl text-ink">Findings</h2>
            {owedItems.map(({ finding, merchant }) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                merchant={merchant}
                simulatedLabel={simulatedLabel}
                onDraftClaim={() => onOpenClaim(finding.id)}
              />
            ))}
          </section>
        ) : null}

        {maybeItems.length > 0 ? (
          <section aria-label="Held for review" className="neu-inset rounded-lg p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-serif text-lg text-ink">Maybe, held until confirmed</h2>
                <p className="mt-1 text-sm text-ink-muted">
                  {summary.excludedCount}{" "}
                  {summary.excludedCount === 1 ? "finding" : "findings"} worth{" "}
                  {formatMoney(summary.excludedTotal, summary.currency)} need a quick
                  look before we count them. Left out of your total on purpose.
                </p>
              </div>
              <Button type="button" variant="secondary" onClick={onOpenReview}>
                Review these
              </Button>
            </div>

            <ul className="mt-5 space-y-3">
              {maybeItems.map(({ finding, merchant }) => (
                <li
                  key={finding.id}
                  className="neu-raised-sm flex flex-wrap items-center justify-between gap-2 rounded-sm px-4 py-3"
                >
                  <span className="text-sm text-ink">{merchant}</span>
                  <span className="flex items-center gap-2">
                    {finding.simulated ? <Chip tone="neutral">{simulatedLabel}</Chip> : null}
                    <Chip tone="review">
                      {formatMoney(finding.amountAtStake, finding.currency)} needs review
                    </Chip>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
