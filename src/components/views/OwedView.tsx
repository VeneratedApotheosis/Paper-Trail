"use client";

import type { Finding, FindingStatus } from "@/lib/contracts";
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
  // Drafted findings: the user approved a claim, so it still counts toward the
  // total until they mark it resolved or dismissed (#77).
  claimSentItems?: OwedFindingItem[];
  simulatedLabel: string;
  onOpenClaim: (findingId: string) => void;
  onOpenReview: () => void;
  onBrowseLedger: () => void;
  onLoadDemo?: () => void;
  // When supplied, claim-sent rows expose "Mark resolved" / "Dismiss".
  onSetStatus?: (findingId: string, status: FindingStatus) => void;
}

export function OwedView({
  summary,
  owedItems,
  maybeItems,
  claimSentItems = [],
  simulatedLabel,
  onOpenClaim,
  onOpenReview,
  onBrowseLedger,
  onLoadDemo,
  onSetStatus,
}: OwedViewProps) {
  const claimSentTotal = summary.claimSentTotal ?? 0;
  const isEmpty =
    summary.owedTotal === 0 &&
    owedItems.length === 0 &&
    maybeItems.length === 0 &&
    claimSentItems.length === 0;

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

        {claimSentTotal > 0 ? (
          <p className="-mt-4 text-center text-sm text-ink-muted">
            Includes {formatMoney(claimSentTotal, summary.currency)} you&apos;ve already claimed,
            counted until it&apos;s resolved.
          </p>
        ) : null}

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

        {claimSentItems.length > 0 ? (
          <section aria-label="Claims you've sent" className="space-y-4">
            <h2 className="font-serif text-2xl text-ink">Claims sent</h2>
            <ul className="space-y-3">
              {claimSentItems.map(({ finding, merchant }) => (
                <li
                  key={finding.id}
                  className="neu-raised-sm flex flex-wrap items-center justify-between gap-3 rounded-sm px-4 py-3"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-ink">{merchant}</span>
                    {finding.simulated ? <Chip tone="neutral">{simulatedLabel}</Chip> : null}
                    <Chip tone="saved">Claim sent</Chip>
                  </span>
                  <span className="flex flex-wrap items-center gap-3">
                    <span className="font-serif tabular-nums text-money">
                      {formatMoney(finding.amountAtStake, finding.currency)}
                    </span>
                    {onSetStatus ? (
                      <span className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onSetStatus(finding.id, "resolved")}
                          className="rounded-sm px-3 py-1 text-label font-bold text-teal-deep transition-shadow hover:shadow-inset-sm"
                        >
                          Mark resolved
                        </button>
                        <button
                          type="button"
                          onClick={() => onSetStatus(finding.id, "dismissed")}
                          className="rounded-sm px-3 py-1 text-label font-bold text-ink-muted transition-shadow hover:shadow-inset-sm"
                        >
                          Dismiss
                        </button>
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
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
