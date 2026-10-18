"use client";

import { useMemo, useState } from "react";
import type { Finding, FindingStatus } from "@/lib/contracts";
import type { OwedSummary } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { HeroCard } from "@/components/HeroCard";
import { OwedIntro } from "@/components/OwedIntro";
import { FindingCard } from "@/components/FindingCard";
import { Button } from "@/components/ui/Button";
import type { OrderSource } from "@/components/sourceAccounts";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/states";
import { formatMoney } from "@/lib/format";
import { OwedBreakdown } from "@/components/OwedBreakdown";
import { ClosingSoonCard, ClosingStrip, NextStepsCard, StoresCard } from "@/components/OwedRail";
import { closingSoon, groupByKind, sortByUrgency, storeTotals } from "@/components/owedGroups";
import type { FindingKind } from "@/lib/contracts";

// Props-only view for the hero "You're owed $X" screen. All data arrives as
// props (typed via @/lib/contracts) and every action is a callback, so the page
// wrapper (and later ui-wiring) owns data + navigation. No fetch, no @/lib/api.
export interface OwedFindingItem {
  finding: Finding;
  merchant: string;
  /** Mailboxes the finding's order came from (issue #115); empty for demo and uploaded purchases. */
  sources?: OrderSource[];
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
  const [kindFilter, setKindFilter] = useState<FindingKind | "all">("all");
  const now = useMemo(() => new Date(), []);
  const sortedItems = useMemo(() => sortByUrgency(owedItems, now), [owedItems, now]);
  const kindGroups = useMemo(() => groupByKind(owedItems, summary.currency), [owedItems, summary.currency]);
  const visibleItems = kindFilter === "all" ? sortedItems : sortedItems.filter((i) => i.finding.kind === kindFilter);
  const closingRows = useMemo(() => closingSoon(owedItems, now, 4), [owedItems, now]);
  const stores = useMemo(() => storeTotals(owedItems, summary.currency, 5), [owedItems, summary.currency]);
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

  const tabClass = (on: boolean) =>
    `inline-flex min-h-[44px] flex-none items-center whitespace-nowrap rounded-full px-4 text-sm font-bold transition-shadow md:min-h-[36px] ${
      on ? "neu-accent" : "neu-raised-sm text-ink-muted hover:text-ink"
    }`;

  return (
    <AppShell>
      {/* data-layout="wide" lets the shell use the full desktop width (#133); below xl it is one column. */}
      <div data-layout="wide" className="mx-auto max-w-ledger space-y-6 xl:max-w-none">
        <header className="space-y-1">
          <h1 className="sr-only font-serif text-3xl text-ink xl:not-sr-only xl:text-[2.5rem] xl:leading-tight">
            Owed to you
          </h1>
          <p className="hidden text-base text-ink-muted xl:block">
            Money your receipts say you can get back. You are owed {formatMoney(summary.owedTotal, summary.currency)}.
          </p>
        </header>

        <div className="space-y-6 xl:grid xl:grid-cols-[minmax(0,1fr)_22.5rem] xl:items-start xl:gap-8 xl:space-y-0">
          <div className="min-w-0 space-y-6">
            <HeroCard
              total={summary.owedTotal}
              currency={summary.currency}
              count={summary.findingCount}
              waitingCount={summary.excludedCount}
              onDraftClaims={scrollToFindings}
              onReview={onOpenReview}
            >
              <OwedBreakdown groups={kindGroups} currency={summary.currency} />
            </HeroCard>

            <div className="space-y-1 text-sm text-ink-muted">
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
                    className="inline-flex min-h-[44px] items-center font-bold text-teal-deep underline underline-offset-2 md:min-h-0"
                  >
                    {summary.excludedCount} {summary.excludedCount === 1 ? "item needs" : "items need"} a
                    quick check first
                  </button>
                </p>
              ) : null}
            </div>

            <div className="xl:hidden">
              <ClosingStrip rows={closingRows} now={now} />
            </div>

            {owedItems.length > 0 ? (
              <section id="findings" aria-label="Money you can get back" className="space-y-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 className="font-serif text-2xl text-ink">Money you can get back</h2>
                  <p className="text-sm text-ink-muted">Closing soonest first</p>
                </div>
                {kindGroups.length > 1 ? (
                  <div role="group" aria-label="Filter by type" className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-3 pt-1.5 sm:mx-0 sm:flex-wrap sm:px-1.5">
                    <button type="button" aria-pressed={kindFilter === "all"} onClick={() => setKindFilter("all")} className={tabClass(kindFilter === "all")}>
                      All {owedItems.length}
                    </button>
                    {kindGroups.map((g) => (
                      <button
                        key={g.kind}
                        type="button"
                        aria-pressed={kindFilter === g.kind}
                        onClick={() => setKindFilter(g.kind)}
                        className={tabClass(kindFilter === g.kind)}
                      >
                        {g.label} {g.count}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="space-y-4">
                  {visibleItems.map(({ finding, merchant, sources }) => (
                    <FindingCard
                      key={finding.id}
                      finding={finding}
                      merchant={merchant}
                      sources={sources}
                      simulatedLabel={simulatedLabel}
                      onDraftClaim={() => onOpenClaim(finding.id)}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {claimSentItems.length > 0 ? (
              <section aria-label="Claims you've sent" className="space-y-4">
                <h2 className="font-serif text-2xl text-ink">Claims sent</h2>
                <ul className="space-y-3">
                  {claimSentItems.map(({ finding, merchant }) => (
                    <li
                      key={finding.id}
                      className="neu-raised-sm flex flex-wrap items-center justify-between gap-3 rounded-md px-5 py-4"
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
                          <span className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onSetStatus(finding.id, "resolved")}
                              className="inline-flex min-h-[44px] items-center rounded-sm px-3 py-1 text-label font-bold text-teal-deep transition-shadow hover:shadow-inset-sm md:min-h-[36px]"
                            >
                              Mark resolved
                            </button>
                            <button
                              type="button"
                              onClick={() => onSetStatus(finding.id, "dismissed")}
                              className="inline-flex min-h-[44px] items-center rounded-sm px-3 py-1 text-label font-bold text-ink-muted transition-shadow hover:shadow-inset-sm md:min-h-[36px]"
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
                      className="neu-raised-sm flex flex-wrap items-center justify-between gap-2 rounded-md px-4 py-3"
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

          {/* Right rail (xl and up): context for the list, built from the same findings. */}
          {owedItems.length > 0 ? (
            <aside aria-label="Context" className="hidden space-y-5 xl:block">
              <ClosingSoonCard rows={closingRows} now={now} />
              <StoresCard stores={stores} currency={summary.currency} />
              <NextStepsCard />
            </aside>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}