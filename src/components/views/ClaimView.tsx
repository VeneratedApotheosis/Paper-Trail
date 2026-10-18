"use client";

import { useId, useState } from "react";
import type { Finding, FindingKind, NormalizedOrder } from "@/lib/contracts";
import type { Draft } from "@/lib/types";
import { SourceBadge } from "@/components/SourceBadge";
import { orderSources, type SourceAccount } from "@/components/sourceAccounts";
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
  /** Linked Gmail accounts (issue #115): `order.sources` ids are shown as the mailbox the purchase came from. */
  accounts?: readonly SourceAccount[];
  onApprove: (edited: { subject: string; body: string; recipient: string }) => void;
  approved?: boolean;
  approvedAt?: string;
  mailtoUrl?: string | null;
  copyStatus?: "idle" | "copied" | "failed";
  pending?: boolean;
  error?: string | null;
  warnings?: string[];
  note?: string;
  recipientVerified?: boolean;
  onSave?: (edited: { subject: string; body: string; recipient: string }) => void;
  onSetStatus?: (status: "open" | "resolved" | "dismissed") => void;
  findingStatus?: Finding["status"];
  /** When provided, drives the confirmation banner instead of local state. */
  confirmed?: boolean;
}

export function ClaimView({
  finding,
  order,
  draft,
  simulatedLabel,
  accounts = [],
  onApprove,
  approved = false, approvedAt, mailtoUrl, copyStatus = "idle", pending = false, error, warnings = [], note, recipientVerified, onSave, onSetStatus, findingStatus = finding.status,
}: ClaimViewProps) {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [recipient, setRecipient] = useState(draft.recipient);

  const sources = orderSources(order.sources, accounts);
  const subjectId = useId();
  const bodyId = useId();

  const amount = formatMoney(finding.amountAtStake, finding.currency);
  const dirty = subject !== draft.subject || body !== draft.body || recipient !== draft.recipient;
  const canOpenEmail = approved && !dirty && !pending && mailtoUrl?.startsWith("mailto:");
  function handleApprove() { onApprove({ subject, body, recipient }); }

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
        {sources.length > 0 ? (
          <p className="mt-3">
            <SourceBadge sources={sources} full />
          </p>
        ) : null}
      </header>

      {recipientVerified === false ? <p className="mt-3 text-sm text-ink-muted">Check the recipient address before sending. It was inferred from the merchant.</p> : null}
      {warnings.length ? <ul className="neu-inset mt-4 rounded-lg p-4 text-sm">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : null}
      {note ? <p className="mt-3 text-sm text-ink-muted">{note}</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm">{error}</p> : null}
      {/* The letter — editable, reads like paper */}
      <section className="neu-raised mt-8 rounded-xl p-6 md:p-8">
        <div className="flex items-baseline justify-between gap-4">
          <p className="eyebrow">To</p>
          <label className="flex-1 text-sm text-ink-muted">Recipient<input aria-label="Recipient" disabled={pending} value={recipient} onChange={e => setRecipient(e.target.value)} className="neu-inset mt-2 w-full rounded-lg bg-transparent px-3 py-2" /></label>
        </div>

        <hr className="mt-4 border-0 border-t border-rule/70" />

        <div className="mt-6">
          <label htmlFor={subjectId} className="eyebrow">
            Subject
          </label>
          <input
            disabled={pending}
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
            disabled={pending}
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
          <Button type="button" variant="primary" disabled={pending} onClick={handleApprove}>
            {pending ? "Saving approval…" : "Approve and copy"}
          </Button>
          {onSave ? <Button variant="secondary" disabled={pending} onClick={() => onSave({ subject, body, recipient })}>Save changes</Button> : null}
          {canOpenEmail ? <a
            href={mailtoUrl!}
            className="neu-raised-sm inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-bold text-teal-deep transition-[box-shadow,transform] active:scale-[0.99]"
          >
            Open in email
          </a> : null}
        </div>
      </section>

      {onSetStatus ? <div className="mt-5 flex flex-wrap gap-3">
        {findingStatus !== "resolved" ? <Button variant="secondary" disabled={pending} onClick={() => onSetStatus("resolved")}>Mark resolved</Button> : null}
        {findingStatus !== "dismissed" ? <Button variant="secondary" disabled={pending} onClick={() => onSetStatus("dismissed")}>Dismiss</Button> : null}
        {findingStatus === "resolved" || findingStatus === "dismissed" ? <Button variant="secondary" disabled={pending} onClick={() => onSetStatus("open")}>Reopen</Button> : null}
      </div> : null}
      {/* Approval confirmation. The role=status live region is always mounted so
          screen readers observe it before the text appears; only its inner
          content is toggled on approval. */}
      <div role="status" aria-live="polite">
        {approved && !dirty ? (
          <div className="neu-inset animate-fade-rise mt-6 rounded-xl px-5 py-4">
            <p className="font-serif text-lg text-teal-deep">
              {copyStatus === "copied" ? "Approved and copied to clipboard" : copyStatus === "failed" ? "Approved, but not copied" : "Claim approved"}
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              {approvedAt ? `Approved ${new Date(approvedAt).toLocaleString()}. ` : ""}This approval is logged to your audit trail. You still send the
              email yourself. PaperTrail never sends it for you.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
