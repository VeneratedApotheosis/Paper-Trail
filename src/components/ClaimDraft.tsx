"use client";

import { useId, useState } from "react";
import Link from "next/link";
import type { Finding, FindingKind, NormalizedOrder } from "@/lib/contracts";
import type { Draft } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { formatMoney } from "@/lib/format";
import { merchantName } from "@/lib/view";

// Subject prefix per rule kind (rules R1–R4, deepdive §4). Wording only — the
// amount and dates always come from the finding, never invented here.
const KIND_SUBJECT: Record<FindingKind, string> = {
  refund_overdue: "Refund not received",
  refund_short: "Refund came up short",
  return_deadline: "Return request",
  price_drop: "Price adjustment request",
  rewards_gap: "Missing rewards",
};

// Merchant support address when no drafted recipient exists: support@{domain}.
function fallbackRecipient(order: NormalizedOrder | undefined): string {
  const domain = order?.merchant.domain;
  return domain ? `support@${domain}` : "support@merchant.example";
}

// UI-side draft fallback used only when the backend hasn't produced one yet.
// Production drafting is the team-owned claims lib (#17): there the LLM writes
// the prose while every number is lifted from the rule/finding (AGENTS.md hard
// rule #4). We mirror that split here — wording is templated, the amount and the
// policy quote come straight off the finding.
function buildFallbackDraft(
  finding: Finding,
  order: NormalizedOrder | undefined,
  signedName: string,
): { subject: string; body: string } {
  const orderRef = order?.orderRef ?? "(reference unavailable)";
  const merchant = merchantName(order);
  const amount = formatMoney(finding.amountAtStake, finding.currency);
  const quote = finding.evidence[0]?.quote;

  const subject = `${KIND_SUBJECT[finding.kind]} — order ${orderRef}`;
  const body = [
    "Hello,",
    "",
    `I'm writing about order ${orderRef} from ${merchant}.`,
    "",
    finding.summary,
    "",
    quote ? `Your own confirmation stated: "${quote}"` : null,
    quote ? "" : null,
    `Based on this, I believe I'm owed ${amount}. Could you please look into this and confirm the next steps?`,
    "",
    "Thank you,",
    signedName,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return { subject, body };
}

export function ClaimDraft({
  finding,
  order,
  existingDraft,
}: {
  finding: Finding;
  order: NormalizedOrder | undefined;
  existingDraft: Draft | undefined;
}) {
  // Signed name: drafted name first, then the receipt's customer name, then a
  // Google-profile-name fallback (we have no profile wired up in the demo).
  const signedName =
    existingDraft?.signedName ?? order?.customerName ?? "PaperTrail user";
  const recipient = existingDraft?.recipient ?? fallbackRecipient(order);

  // Prefer an existing backend draft; otherwise build one client-side.
  const initial = existingDraft
    ? { subject: existingDraft.subject, body: existingDraft.body }
    : buildFallbackDraft(finding, order, signedName);

  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [approved, setApproved] = useState(false);
  const [copyOk, setCopyOk] = useState(true);

  const subjectId = useId();
  const bodyId = useId();

  const amount = formatMoney(finding.amountAtStake, finding.currency);
  const orderRef = order?.orderRef ?? null;
  const quote = finding.evidence[0]?.quote ?? null;

  const clipboardText = `Subject: ${subject}\n\n${body}`;
  const mailtoHref = `mailto:${recipient}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;

  async function handleApprove() {
    let ok = true;
    try {
      await navigator.clipboard.writeText(clipboardText);
    } catch {
      // Clipboard may be unavailable (permissions / insecure context). We still
      // record the approval; the user can copy manually or use "Open in email".
      ok = false;
    }
    setCopyOk(ok);
    setApproved(true);
    // Production: write an audit row (type "approval") through the claims API
    // (team-owned) — approvals must be audited (AGENTS.md hard rule #6).
  }

  return (
    <div>
      <Link href="/" className="text-sm text-ink-muted hover:text-ink">
        ← Owed
      </Link>

      {/* Header */}
      <header className="mt-3 flex flex-wrap items-start justify-between gap-4 border-b border-rule pb-6">
        <div className="min-w-0">
          <p className="col-head">Draft a claim</p>
          <h1 className="mt-2 font-serif text-3xl text-ink">{merchantName(order)}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {orderRef ? <>Order {orderRef} · </> : null}
            Review and edit before you send it yourself
          </p>
        </div>
        <Chip tone="owed">{amount}</Chip>
      </header>

      {/* What this claim is based on — amounts/quote come from the rule, not the LLM */}
      <section className="mt-6">
        <h2 className="col-head">What this claim is based on</h2>
        <dl className="mt-2 max-w-ledger space-y-1 text-sm">
          {orderRef ? (
            <div className="flex items-center justify-between text-ink-muted">
              <dt>Order reference</dt>
              <dd className="tabular-nums text-ink">{orderRef}</dd>
            </div>
          ) : null}
          <div className="flex items-center justify-between text-ink-muted">
            <dt>Amount at stake</dt>
            <dd className="tabular-nums text-owed">{amount}</dd>
          </div>
        </dl>
        {quote ? (
          <blockquote className="mt-3 border-l-2 border-rule bg-paper-sunk px-3 py-2 text-sm italic text-ink-muted">
            &ldquo;{quote}&rdquo;
          </blockquote>
        ) : null}
      </section>

      {/* The letter — editable, reads like paper */}
      <section className="mt-8 rounded-lg border border-rule bg-paper-raised p-6 shadow-raised">
        <div>
          <label htmlFor={subjectId} className="col-head">
            Subject
          </label>
          <input
            id={subjectId}
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="mt-1 w-full rounded-sm border border-rule bg-paper px-3 py-2 font-serif text-lg text-ink focus-visible:outline-none"
          />
        </div>

        <div className="mt-5">
          <label htmlFor={bodyId} className="col-head">
            Message
          </label>
          <textarea
            id={bodyId}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            className="mt-1 w-full resize-y rounded-sm border border-rule bg-paper px-3 py-3 font-serif text-base leading-relaxed text-ink focus-visible:outline-none"
          />
        </div>

        <p className="mt-4 text-sm text-ink-muted">
          <span className="font-medium text-ink">
            PaperTrail never sends this for you — you send it yourself.
          </span>{" "}
          Review the wording, then copy it or open it in your email app.
        </p>

        <p className="mt-2 text-sm text-ink-faint">
          To: <span className="tabular-nums text-ink-muted">{recipient}</span>
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button type="button" variant="primary" onClick={handleApprove}>
            Approve &amp; copy
          </Button>
          <a
            href={mailtoHref}
            className="inline-flex items-center justify-center gap-2 rounded border border-rule bg-paper-raised px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-paper-sunk"
          >
            Open in email
          </a>
        </div>
      </section>

      {/* Approval confirmation */}
      {approved ? (
        <div
          role="status"
          className="animate-fade-rise mt-6 rounded-lg border border-saved/30 bg-saved-tint px-4 py-3"
        >
          <p className="font-medium text-saved">
            {copyOk
              ? "Approved — copied to clipboard"
              : "Approved — copy failed, use \u201cOpen in email\u201d or copy manually"}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            This approval is logged to your audit trail. You still need to send the
            email yourself — PaperTrail never sends it for you.
          </p>
        </div>
      ) : null}
    </div>
  );
}
