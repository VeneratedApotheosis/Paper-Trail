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
    <article className="neu-raised rounded-lg p-5 md:px-5 md:py-4">
      {/* Phones: title and amount, then chips, then Why? and the claim button. From md the same pieces sit in one row (display: contents on the wrappers). */}
      <div className="space-y-3 md:grid md:grid-cols-[minmax(0,1fr)_10rem_5rem_auto] md:items-center md:gap-x-3 md:space-y-0">
        <div className="flex items-start justify-between gap-3 md:contents">
          <div className="min-w-0 md:col-start-1 md:row-start-1">
            <h3 className="font-serif text-lg text-ink">{KIND_LABELS[finding.kind]}</h3>
            <p className="truncate text-sm text-ink-muted">{merchant}</p>
          </div>
          <span className="flex-none text-right font-serif text-xl font-semibold text-money tabular-nums md:col-start-3 md:row-start-1">
            {formatMoney(finding.amountAtStake, finding.currency)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 md:col-start-2 md:row-start-1">
          {finding.dueAt ? (
            <Chip tone={overdue ? "owed" : "deadline"}>{countdownLabel(finding.dueAt)}</Chip>
          ) : null}
          {finding.simulated ? <Chip tone="neutral">{simulatedLabel}</Chip> : null}
          <SourceBadge sources={sources} />
        </div>

        <div className="flex items-center justify-between gap-1 md:col-start-4 md:row-start-1 md:justify-end">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={panelId}
            className="inline-flex min-h-[44px] items-center rounded-sm px-3 py-2 text-sm font-bold text-teal-deep transition-shadow hover:shadow-inset-sm md:min-h-[36px]"
          >
            {expanded ? "Hide why" : "Why?"}
          </button>
          <Button type="button" variant="primary" onClick={onDraftClaim} className="md:min-h-[36px] md:px-4 md:py-2">
            Draft a claim
          </Button>
        </div>
      </div>

      {/* Panel stays mounted so aria-controls always resolves; `hidden` toggles
          visibility and the fade-rise entry only plays while expanded. */}
      <div
        id={panelId}
        hidden={!expanded}
        className={`mt-4 space-y-5 ${expanded ? "animate-fade-rise" : ""}`}
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
