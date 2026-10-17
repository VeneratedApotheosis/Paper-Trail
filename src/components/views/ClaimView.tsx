"use client";

import { useId, useState } from "react";
import type { Finding, FindingKind, NormalizedOrder } from "@/lib/contracts";
import type { Draft } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { formatMoney } from "@/lib/format";
import { merchantName } from "@/lib/view";

// Props-only view for the claim draft sheet (#17). All data arrives as props
// (typed via @/lib/contracts / @/lib/types) and the single action bubbles up
// through onApprove. No fetch, no @/lib/api|store|mock, no routing — the page
// wrapper owns data + navigation. The editable subject/body are local view
// state seeded from the draft; approving sends the edited copy back up.
// Hard rules honored here: the amount is read straight off the finding (never
// edited in this view, rule #4) and the app never sends email (rule #2).

// Short human label for the summary line under the title.
const KIND_LABEL: Record<FindingKind, string> = {
  refund_overdue: "Refund overdue",
  refund_short: "Refund short",
  return_deadline: "Return window closing",
  price_drop: "Price drop",
  rewards_gap: "Rewards gap",
};

export interface ClaimViewProps {
  finding: Finding;
  order: NormalizedOrder;
  draft: Draft;
  simulatedLabel: string;
  onApprove: (edited: { subject: string; body: string }) => void;
  /** When provided, drives the confirmation banner instead of local state. */
  confirmed?: boolean;
}

export function ClaimView({
  finding,
  order,
  draft,
  simulatedLabel,
  onApprove,
  confirmed,
}: ClaimViewProps) {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [approvedLocal, setApprovedLocal] = useState(false);

  const subjectId = useId();
  const bodyId = useId();

  const amount = formatMoney(finding.amountAtStake, finding.currency);
  const recipient = draft.recipient;

  // mailto is an email affordance, not app routing — a plain anchor is fine.
  const mailtoHref = `mailto:${recipient}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;

  const approved = confirmed ?? approvedLocal;

  function handleApprove() {
    onApprove({ subject, body });
    // Only drive local confirmation when the parent isn't controlling it.
    if (confirmed === undefined) setApprovedLocal(true);
  }

  return (
    <div>
      {/* Header */}
      <header>
        <h1 className="font-serif text-3xl text-ink">Claim draft</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {KIND_LABEL[finding.kind]}, {merchantName(order)},{" "}
          <span className="font-serif text-money">{amount}</span>
        </p>
        {/* Label simulated amounts on this screen too (AGENTS hard rule #8) —
            not only via the global demo banner. */}
        {finding.simulated ? (
          <p className="neu-inset mt-3 inline-block rounded-md px-2.5 py-1 text-xs text-ink-muted">
            {simulatedLabel}
          </p>
        ) : null}
      </header>

      {/* The letter — editable, reads like paper */}
      <section className="neu-raised mt-8 rounded-xl p-6 md:p-8">
        <div className="flex items-baseline justify-between gap-4">
          <p className="eyebrow">To</p>
          <p className="truncate text-sm text-ink-muted">{recipient}</p>
        </div>

        <hr className="mt-4 border-0 border-t border-rule/70" />

        <div className="mt-6">
          <label htmlFor={subjectId} className="eyebrow">
            Subject
          </label>
          <input
            id={subjectId}
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="neu-inset mt-2 w-full rounded-lg bg-transparent px-4 py-3 font-serif text-xl text-ink focus-visible:outline-none"
          />
        </div>

        <div className="mt-6">
          <label htmlFor={bodyId} className="eyebrow">
            Message
          </label>
          <textarea
            id={bodyId}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            className="neu-inset mt-2 w-full resize-y rounded-lg bg-transparent px-4 py-4 font-sans text-base leading-relaxed text-ink focus-visible:outline-none"
          />
        </div>

        <p className="neu-inset mt-6 rounded-lg px-4 py-3 text-sm text-ink-muted">
          <span className="font-semibold text-ink">
            PaperTrail never sends this for you.
          </span>{" "}
          You send it yourself.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button type="button" variant="primary" onClick={handleApprove}>
            Approve and copy
          </Button>
          <a
            href={mailtoHref}
            className="neu-raised-sm inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-bold text-teal-deep transition-[box-shadow,transform] active:scale-[0.99]"
          >
            Open in email
          </a>
        </div>
      </section>

      {/* Approval confirmation. The role=status live region is always mounted so
          screen readers observe it before the text appears; only its inner
          content is toggled on approval. */}
      <div role="status" aria-live="polite">
        {approved ? (
          <div className="neu-inset animate-fade-rise mt-6 rounded-xl px-5 py-4">
            <p className="font-serif text-lg text-teal-deep">
              Approved and copied to clipboard
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              This approval is logged to your audit trail. You still send the
              email yourself. PaperTrail never sends it for you.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
