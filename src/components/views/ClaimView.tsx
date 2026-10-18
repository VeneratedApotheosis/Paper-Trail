"use client";

import { useId, useState } from "react";
import type { Finding, FindingKind, NormalizedOrder } from "@/lib/contracts";
import type { Draft } from "@/lib/types";
import { SourceBadge } from "@/components/SourceBadge";
import { orderSources, type SourceAccount } from "@/components/sourceAccounts";
import { explainConfidence } from "@/components/findingExplain";
import { Chip } from "@/components/ui/Chip";
import { claimSteps, type ClaimStepState } from "@/components/views/claimSteps";
import { confidenceLabel, countdownLabel, formatMoney } from "@/lib/format";
import { merchantName } from "@/lib/view";

// Props-only view for the claim draft sheet (#17, #140). All data arrives as props
// (typed via @/lib/contracts / @/lib/types) and the single action bubbles up
// through onApprove. No fetch, no @/lib/api|store|mock, no routing — the page
// wrapper owns data + navigation. The editable subject/body are local view
// state seeded from the draft; approving sends the edited copy back up.
// Hard rules honored here: the amount is read straight off the finding (never
// edited in this view, rule #4) and the app never sends email (rule #2).
// Layout: one column below xl (letter, then what your emails say, then steps); from xl the letter sits
// beside a right rail with the finding and the steps. data-layout="wide" lets the shell use the full width.

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
  /** Shows the "Back to Owed to you" link from xl. Optional: the page wrapper adds it when it wants the link. */
  onBack?: () => void;
}

const pillBase =
  "inline-flex min-h-[48px] w-full items-center justify-center rounded-full px-6 text-sm font-bold transition-[box-shadow,transform] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 xl:min-h-[44px] xl:w-auto";
const pillPrimary = `${pillBase} neu-accent`;
const pillSecondary = `${pillBase} neu-raised-sm text-teal-deep`;

const stepCircle: Record<ClaimStepState, string> = {
  done: "neu-inset text-teal-deep",
  current: "neu-accent",
  todo: "neu-raised-sm text-ink-muted",
};
const stepWord: Record<ClaimStepState, string> = { done: "done", current: "current step", todo: "not started" };

function EnvelopeIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.75" y="3.25" width="12.5" height="9.5" rx="2" />
      <path d="m2.5 4.5 5.5 4.25L13.5 4.5" />
    </svg>
  );
}

export function ClaimView({
  finding,
  order,
  draft,
  simulatedLabel,
  accounts = [],
  onApprove,
  approved = false,
  approvedAt,
  mailtoUrl,
  copyStatus = "idle",
  pending = false,
  error,
  warnings = [],
  note,
  recipientVerified,
  onSave,
  onSetStatus,
  findingStatus = finding.status,
  onBack,
}: ClaimViewProps) {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [recipient, setRecipient] = useState(draft.recipient);

  const sources = orderSources(order.sources, accounts);
  const recipientId = useId();
  const subjectId = useId();
  const bodyId = useId();

  const merchant = merchantName(order);
  const amount = formatMoney(finding.amountAtStake, finding.currency);
  const dirty = subject !== draft.subject || body !== draft.body || recipient !== draft.recipient;
  const approvedNow = approved && !dirty;
  const canOpenEmail = approvedNow && !pending && Boolean(mailtoUrl?.startsWith("mailto:"));
  const confidence = explainConfidence(finding.explain);
  const steps = claimSteps({ approved: approvedNow, copyStatus, findingStatus });
  function handleApprove() { onApprove({ subject, body, recipient }); }

  const bannerTitle = copyStatus === "copied" ? "Approved and copied." : copyStatus === "failed" ? "Approved, but not copied." : "Claim approved.";
  const bannerText =
    copyStatus === "copied"
      ? "Paste it into your mail app, or open it below. You send it yourself."
      : copyStatus === "failed"
        ? "Use Copy again, or open it in email. You send it yourself."
        : "This approval is logged to your audit trail. You send it yourself.";

  return (
    <div data-layout="wide" className="mx-auto max-w-ledger space-y-5 xl:max-w-none xl:space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="min-w-0 space-y-2.5 xl:space-y-3">
          <h1 className="font-serif text-[2.125rem] leading-[2.375rem] text-ink xl:text-3xl xl:leading-tight">Claim draft</h1>
          <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm text-ink-faint xl:text-base">
            <span>
              {KIND_LABEL[finding.kind]}, {merchant},
            </span>
            <span className="font-serif text-base font-semibold text-money xl:text-[1.0625rem]">{amount}</span>
          </p>
          {/* Label simulated amounts on this screen too (AGENTS hard rule #8) —
              not only via the global demo banner. */}
          {finding.simulated || sources.length > 0 ? (
            <p className="flex flex-wrap items-center gap-2">
              {finding.simulated ? <Chip tone="neutral">{simulatedLabel}</Chip> : null}
              <SourceBadge sources={sources} full />
            </p>
          ) : null}
        </div>
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="hidden min-h-[44px] items-center text-sm font-bold text-teal-deep underline-offset-2 hover:underline xl:inline-flex"
          >
            ← Back to Owed to you
          </button>
        ) : null}
      </header>

      <div className="space-y-4 xl:grid xl:grid-cols-[minmax(0,1fr)_22.5rem] xl:items-start xl:gap-8 xl:space-y-0">
        <div className="min-w-0 space-y-4 xl:space-y-5">
          {recipientVerified === false ? <p className="text-sm text-ink-muted">Check the recipient address before sending. It was inferred from the merchant.</p> : null}
          {warnings.length ? <ul className="neu-inset rounded-lg p-4 text-sm">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : null}
          {note ? <p className="text-sm text-ink-muted">{note}</p> : null}
          {error ? <p role="alert" className="text-sm">{error}</p> : null}

          {/* Approval confirmation. The role=status live region is always mounted so
              screen readers observe it before the text appears; only its inner
              content is toggled on approval. */}
          <div role="status" aria-live="polite">
            {approvedNow ? (
              <div className="neu-inset animate-fade-rise rounded-md p-4 text-sm leading-5">
                <span className="text-teal-deep">{bannerTitle}</span>{" "}
                <span className="text-ink-muted">
                  {approvedAt ? `Approved ${new Date(approvedAt).toLocaleString()}. ` : ""}
                  {bannerText}
                </span>
              </div>
            ) : null}
          </div>

          {/* The letter: editable, reads like paper */}
          <section aria-label="Your claim letter" className="neu-raised space-y-3 rounded-lg p-5 xl:space-y-4 xl:p-6">
            <div className="xl:flex xl:items-center xl:gap-4">
              <label htmlFor={recipientId} className="sr-only text-sm text-ink-faint xl:not-sr-only xl:w-[4.5rem] xl:shrink-0">
                To
              </label>
              <input
                id={recipientId}
                aria-label="Recipient"
                disabled={pending}
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="neu-inset min-h-[44px] w-full min-w-0 rounded-md bg-transparent px-4 py-2 text-sm text-ink xl:flex-1"
              />
            </div>

            <div className="xl:flex xl:items-center xl:gap-4">
              <label htmlFor={subjectId} className="sr-only text-sm text-ink-faint xl:not-sr-only xl:w-[4.5rem] xl:shrink-0">
                Subject
              </label>
              <input
                disabled={pending}
                id={subjectId}
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="neu-inset min-h-[48px] w-full min-w-0 rounded-md bg-transparent px-4 py-3 font-serif text-[1.0625rem] leading-[1.375rem] text-ink xl:min-h-[44px] xl:flex-1 xl:py-2"
              />
            </div>

            <div>
              <label htmlFor={bodyId} className="sr-only">
                Message
              </label>
              <textarea
                disabled={pending}
                id={bodyId}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={14}
                className="neu-inset w-full resize-y rounded-md bg-transparent p-4 font-sans text-sm leading-[1.375rem] text-ink xl:p-5 xl:leading-6"
              />
            </div>

            <p className="text-label font-normal normal-case tracking-normal text-ink-faint xl:hidden">
              <span className="font-semibold text-ink">PaperTrail never sends this for you.</span> You send it yourself.
            </p>

            <div className="flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-center">
              {approvedNow ? (
                <>
                  {canOpenEmail ? (
                    <a href={mailtoUrl!} className={pillPrimary}>
                      Open in email
                    </a>
                  ) : null}
                  <button type="button" disabled={pending} onClick={handleApprove} className={canOpenEmail ? pillSecondary : pillPrimary}>
                    {pending ? "Saving approval…" : "Copy again"}
                  </button>
                </>
              ) : (
                <button type="button" disabled={pending} onClick={handleApprove} className={pillPrimary}>
                  {pending ? "Saving approval…" : "Approve and copy"}
                </button>
              )}
              {onSave ? (
                <button type="button" disabled={pending} onClick={() => onSave({ subject, body, recipient })} className={pillSecondary}>
                  Save changes
                </button>
              ) : null}
              {onSetStatus && findingStatus !== "resolved" ? (
                <button type="button" disabled={pending} onClick={() => onSetStatus("resolved")} className={pillSecondary}>
                  Mark resolved
                </button>
              ) : null}
              {onSetStatus && findingStatus !== "dismissed" ? (
                <button type="button" disabled={pending} onClick={() => onSetStatus("dismissed")} className={pillSecondary}>
                  Dismiss
                </button>
              ) : null}
              {onSetStatus && (findingStatus === "resolved" || findingStatus === "dismissed") ? (
                <button type="button" disabled={pending} onClick={() => onSetStatus("open")} className={pillSecondary}>
                  Reopen
                </button>
              ) : null}
              <p className="hidden text-right text-label font-normal normal-case tracking-normal text-ink-faint xl:block xl:min-w-[12rem] xl:flex-1">
                <span className="font-semibold text-ink">PaperTrail never sends this for you.</span> You send it yourself.
              </p>
            </div>
          </section>
        </div>

        <div className="space-y-4 xl:space-y-5">
          {/* The finding (xl) and what the emails say (all sizes). One card, so the quote is never shown twice. */}
          <section aria-label="The finding" className="neu-raised space-y-3 rounded-lg p-5 xl:p-6">
            <p className="eyebrow hidden xl:block">The finding</p>
            <h2 className="hidden font-serif text-xl text-ink xl:block">{KIND_LABEL[finding.kind]}</h2>
            <p className="hidden font-serif text-[2.5rem] font-semibold leading-[2.875rem] tabular-nums text-money xl:block">{amount}</p>
            <div className="hidden flex-wrap gap-2 xl:flex">
              {finding.dueAt ? <Chip tone="deadline">{countdownLabel(finding.dueAt)}</Chip> : null}
              {confidence !== null ? <Chip tone="neutral">{confidenceLabel(confidence)}</Chip> : null}
              {finding.simulated ? <Chip tone="neutral">{simulatedLabel}</Chip> : null}
            </div>
            <p className="hidden text-sm text-ink-faint xl:block">
              {merchant}
              {order.orderRef ? `, order ${order.orderRef}` : ""}
            </p>
            <h2 className="font-serif text-xl text-ink xl:sr-only">What your emails say</h2>
            {finding.evidence.length > 0 ? (
              <ul className="space-y-3">
                {finding.evidence.map((e, i) => (
                  <li key={`${e.messageId}-${i}`} className="neu-inset space-y-2.5 rounded-md p-4">
                    <p className="text-sm italic text-ink-faint">&ldquo;{e.quote}&rdquo;</p>
                    {sources.length > 0 ? (
                      <p className="flex items-center gap-1.5 text-label font-semibold normal-case tracking-normal text-ink-faint">
                        <EnvelopeIcon />
                        Read in {sources.map((s) => s.label).join(" and ")}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">{finding.summary}</p>
            )}
          </section>

          <section aria-label="Your steps" className="neu-raised space-y-4 rounded-lg p-5 xl:p-6">
            <h2 className="font-serif text-xl text-ink">Your steps</h2>
            <ol className="space-y-4">
              {steps.map((step, i) => (
                <li key={step.title} className="flex items-center gap-3 xl:gap-3.5" aria-current={step.state === "current" ? "step" : undefined}>
                  <span
                    aria-hidden
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-serif text-sm font-semibold ${stepCircle[step.state]}`}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">
                      {step.title}
                      <span className="sr-only">, {stepWord[step.state]}</span>
                    </span>
                    <span className="hidden text-label font-normal normal-case tracking-normal text-ink-faint xl:block">{step.hint}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
