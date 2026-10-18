"use client";

import type { Finding, FindingStatus } from "@/lib/contracts";
import type { OwedSummary } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { HeroCard } from "@/components/HeroCard";
import { OwedIntro } from "@/components/OwedIntro";
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
  // The page passes onLoadDemo and onConnectGmail only for an empty store: they turn the empty
  // screen into the first-run intro with both ways to start.
  onConnectGmail?: () => void;
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
  onConnectGmail,
  onLoadDemo,
  onSetStatus,
}: OwedViewProps) {
  const claimSentTotal = summary.claimSentTotal ?? 0;
  const isEmpty =
    summary.owedTotal === 0 &&
    owedItems.length === 0 &&
    maybeItems.length === 0 &&
    claimSentItems.length === 0;

  if (isEmpty && (onConnectGmail || onLoadDemo)) {
    return (
      <AppShell>
        <OwedIntro onConnectGmail={onConnectGmail} onLoadDemo={onLoadDemo} />
      </AppShell>
    );
  }

  if (isEmpty) {
    return (
      <AppShell>
        <EmptyState
          title="Nothing owed right now"
          actions={
            <Button type="button" variant="secondary" onClick={onBrowseLedger}>
              Browse purchases
            </Button>
          }
        >
          We found no late refunds, closing return windows or price drops in
          your receipts. Sync again later to check new receipts.
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

        <div className="-mt-4 space-y-1 text-center text-sm text-ink-muted">
          <p>
            Includes refunds, deadlines and price drops we&apos;re confident about, plus claims
            you&apos;ve sent that haven&apos;t been paid yet.
          </p>
          {claimSentTotal > 0 ? (
            <p>
              {formatMoney(claimSentTotal, summary.currency)} of it is from claims you&apos;ve
              sent. It stays counted until you mark it resolved.
            </p>
          ) : null}
          {summary.excludedCount > 0 ? (
            <p>
              <button
                type="button"
                onClick={onOpenReview}
                className="font-bold text-teal-deep underline underline-offset-2"
              >
                {summary.excludedCount} {summary.excludedCount === 1 ? "item needs" : "items need"} a
                quick check first
              </button>
            </p>
          ) : null}
        </div>

        {owedItems.length > 0 ? (
          <section id="findings" aria-label="Money you can get back" className="space-y-4">
            <h2 className="font-serif text-2xl text-ink">Money you can get back</h2>
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
          <section aria-label="Needs a quick check" className="neu-inset rounded-lg p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-serif text-lg text-ink">Needs a quick check</h2>
                <p className="mt-1 text-sm text-ink-muted">
                  {summary.excludedCount} {summary.excludedCount === 1 ? "item" : "items"} worth{" "}
                  {formatMoney(summary.excludedTotal, summary.currency)}{" "}
                  {summary.excludedCount === 1 ? "isn't" : "aren't"} counted in your total
                  until you check {summary.excludedCount === 1 ? "it" : "them"}.
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
                      {formatMoney(finding.amountAtStake, finding.currency)} not counted yet
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
