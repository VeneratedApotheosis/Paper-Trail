import { AppShell } from "@/components/AppShell";
import { FindingCard } from "@/components/FindingCard";
import { HeroCard } from "@/components/HeroCard";
import { LinkButton } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/states";
import { findings, getOrder, owedSummary, SIMULATED_PRICE_LABEL } from "@/lib/mock/data";
import { findingCountsTowardOwed, merchantName } from "@/lib/view";
import { formatMoney } from "@/lib/format";

// Hero "You're owed $X" screen (#16). The headline figure and the stacked
// finding cards come from deterministic mock data; low-confidence / needs-review
// findings are held out of the total until a human confirms (AGENTS.md rule #7).
export default function Home() {
  const summary = owedSummary();
  const openFindings = findings.filter((f) => f.status === "open");
  // Mirror computeOwedSummary's split: what counts toward the headline vs. the
  // "maybe" tray (needs-review orders / low confidence).
  const owedFindings = openFindings.filter((f) =>
    findingCountsTowardOwed(f, getOrder(f.orderId)),
  );
  const maybeFindings = openFindings.filter(
    (f) => !findingCountsTowardOwed(f, getOrder(f.orderId)),
  );

  const nothingOwed = summary.owedTotal === 0 && openFindings.length === 0;

  if (nothingOwed) {
    return (
      <AppShell>
        <EmptyState
          title="Nothing owed right now"
          actions={<LinkButton href="/ledger">Browse the ledger</LinkButton>}
        >
          We went through your receipts and found no overdue refunds, closing
          return windows, or price drops. You&apos;re all squared up. We&apos;ll
          flag anything the moment it appears.
        </EmptyState>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-8">
        <h1 className="sr-only">
          You&apos;re owed {formatMoney(summary.owedTotal, summary.currency)}
        </h1>
        <HeroCard
          total={summary.owedTotal}
          currency={summary.currency}
          count={summary.findingCount}
        />

        {owedFindings.length > 0 ? (
          <section id="findings" aria-label="Open findings" className="space-y-4">
            <h2 className="font-serif text-2xl text-ink">Findings</h2>
            {owedFindings.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                merchant={merchantName(getOrder(finding.orderId))}
              />
            ))}
          </section>
        ) : null}

        {summary.excludedCount > 0 ? (
          <section
            aria-label="Held for review"
            className="neu-inset rounded-lg p-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-serif text-lg text-ink">Maybe, held until confirmed</h2>
                <p className="mt-1 text-sm text-ink-muted">
                  {summary.excludedCount}{" "}
                  {summary.excludedCount === 1 ? "finding" : "findings"} worth{" "}
                  {formatMoney(summary.excludedTotal, summary.currency)} need a
                  quick look before we count them. Left out of your total on
                  purpose.
                </p>
              </div>
              <LinkButton href="/review" variant="secondary">
                Review these
              </LinkButton>
            </div>

            <ul className="mt-5 space-y-3">
              {maybeFindings.map((finding) => (
                <li
                  key={finding.id}
                  className="neu-raised-sm flex flex-wrap items-center justify-between gap-2 rounded-sm px-4 py-3"
                >
                  <span className="text-sm text-ink">
                    {merchantName(getOrder(finding.orderId))}
                  </span>
                  <span className="flex items-center gap-2">
                    {finding.simulated ? <Chip tone="neutral">{SIMULATED_PRICE_LABEL}</Chip> : null}
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
