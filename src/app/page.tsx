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
          return windows, or price drops. You&apos;re all squared up — we&apos;ll
          flag anything the moment it appears.
        </EmptyState>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-8">
        <HeroCard
          total={summary.owedTotal}
          currency={summary.currency}
          count={summary.findingCount}
        />

        <section aria-label="Open findings" className="space-y-4">
          {owedFindings.map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              merchant={merchantName(getOrder(finding.orderId))}
            />
          ))}
        </section>

        {summary.excludedCount > 0 ? (
          <section
            aria-label="Held for review"
            className="rounded-lg border border-dashed border-rule bg-paper-sunk/60 p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-serif text-lg text-ink">Maybe — held until confirmed</h2>
                <p className="mt-0.5 text-sm text-ink-muted">
                  {summary.excludedCount}{" "}
                  {summary.excludedCount === 1 ? "finding" : "findings"} worth{" "}
                  {formatMoney(summary.excludedTotal, summary.currency)} need a
                  quick look before we count them. They&apos;re left out of your
                  total on purpose.
                </p>
              </div>
              <LinkButton href="/review" variant="secondary">
                Review these
              </LinkButton>
            </div>

            <ul className="mt-4 space-y-2">
              {maybeFindings.map((finding) => (
                <li
                  key={finding.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-rule bg-paper-raised px-3 py-2"
                >
                  <span className="text-sm text-ink">
                    {merchantName(getOrder(finding.orderId))}
                  </span>
                  <span className="flex items-center gap-2">
                    {finding.simulated ? <Chip tone="neutral">{SIMULATED_PRICE_LABEL}</Chip> : null}
                    <Chip tone="review">
                      {formatMoney(finding.amountAtStake, finding.currency)} · needs review
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
