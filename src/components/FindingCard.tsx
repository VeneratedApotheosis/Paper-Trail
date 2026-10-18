"use client";

import { useId, useState } from "react";
import type { Finding, FindingKind } from "@/lib/contracts";
import { Button } from "@/components/ui/Button";
import { ConfidenceChip } from "@/components/ConfidenceChip";
import { SourceBadge } from "@/components/SourceBadge";
import type { OrderSource } from "@/components/sourceAccounts";
import { Chip } from "@/components/ui/Chip";
import { explainConfidence, explainRows } from "@/components/findingExplain";
import { countdownLabel, daysUntil, formatMoney } from "@/lib/format";

// Human headline per rule kind (rules R1–R4, deepdive §4).
const KIND_LABELS: Record<FindingKind, string> = {
  refund_overdue: "Refund overdue",
  refund_short: "Refund came up short",
  return_deadline: "Return window closing",
  price_drop: "Price dropped",
  rewards_gap: "Rewards missed",
};

export function FindingCard({
  finding,
  merchant,
  simulatedLabel,
  sources,
  onDraftClaim,
}: {
  finding: Finding;
  merchant: string;
  // Mailboxes the finding's order came from (issue #115); omitted for demo and uploaded purchases.
  sources?: readonly OrderSource[];
  simulatedLabel: string;
  onDraftClaim: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  const overdue = finding.dueAt !== null && daysUntil(finding.dueAt) < 0;
  const explainEntryRows = explainRows(finding.explain, finding.currency);
  const confidence = explainConfidence(finding.explain);

  return (
    <article className="neu-raised rounded-lg p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-xl text-ink">{KIND_LABELS[finding.kind]}</h3>
          <p className="mt-0.5 text-sm text-ink-muted">{merchant}</p>
        </div>
        <span className="font-serif text-2xl font-semibold text-money tabular-nums">
          {formatMoney(finding.amountAtStake, finding.currency)}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {finding.dueAt ? (
          <Chip tone={overdue ? "owed" : "deadline"}>{countdownLabel(finding.dueAt)}</Chip>
        ) : null}
        {finding.simulated ? <Chip tone="neutral">{simulatedLabel}</Chip> : null}
        <SourceBadge sources={sources} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="button" variant="primary" onClick={onDraftClaim}>
          Draft a claim
        </Button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="inline-flex min-h-[44px] items-center rounded-sm px-3 py-2 text-sm font-bold text-teal-deep transition-shadow hover:shadow-inset-sm md:min-h-[36px]"
        >
          {expanded ? "Hide why" : "Why?"}
        </button>
      </div>

      {/* Panel stays mounted so aria-controls always resolves; `hidden` toggles
          visibility and the fade-rise entry only plays while expanded. */}
      <div
        id={panelId}
        hidden={!expanded}
        className={`mt-5 space-y-5 ${expanded ? "animate-fade-rise" : ""}`}
      >
        <p className="text-base text-ink">{finding.summary}</p>

        {confidence !== null ? (
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            How well we read your emails:
            <ConfidenceChip confidence={confidence} />
          </p>
        ) : null}

        <div>
          <p className="eyebrow mb-2">What your emails say</p>
          <ul className="space-y-2">
            {finding.evidence.map((e, i) => (
              <li
                key={`${e.messageId}-${i}`}
                className="neu-inset rounded-sm px-4 py-3 text-sm italic text-ink-muted"
              >
                &ldquo;{e.quote}&rdquo;
              </li>
            ))}
          </ul>
        </div>

        {explainEntryRows.length > 0 ? (
          <div className="neu-inset rounded-sm px-4 py-4">
            <p className="eyebrow mb-2">How we got the number</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {explainEntryRows.map(({ label, value }, index) => (
                <div key={`${label}-${index}`} className="contents">
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="text-ink tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </div>
    </article>
  );
}
