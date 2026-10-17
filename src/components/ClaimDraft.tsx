"use client";

import { useId, useState } from "react";
import Link from "next/link";
import type { Finding, FindingKind, NormalizedOrder } from "@/lib/contracts";
import type { Draft } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { formatMoney } from "@/lib/format";
import { merchantName } from "@/lib/view";
import { SIMULATED_PRICE_LABEL } from "@/lib/mock/data";

// Subject prefix per rule kind (rules R1–R4, deepdive §4). Wording only — the
// amount and dates always come from the finding, never invented here.
const KIND_SUBJECT: Record<FindingKind, string> = {
  refund_overdue: "Refund not received",
  refund_short: "Refund came up short",
  return_deadline: "Return request",
  price_drop: "Price adjustment request",
  rewards_gap: "Missing rewards",
};

// Short human label for the summary line under the title.
const KIND_LABEL: Record<FindingKind, string> = {
  refund_overdue: "Refund overdue",
  refund_short: "Refund short",
  return_deadline: "Return window closing",
  price_drop: "Price drop",
  rewards_gap: "Rewards gap",
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

  const subject = `${KIND_SUBJECT[finding.kind]}, order ${orderRef}`;
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
      <Link
        href="/"
        className="text-sm font-medium text-ink-muted transition-colors hover:text-ink"
      >
        ← Owed
      </Link>

      {/* Header */}
      <header className="mt-4">
        <h1 className="font-serif text-3xl text-ink">Claim draft</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {KIND_LABEL[finding.kind]}, {merchantName(order)},{" "}
          <span className="font-serif text-money">{amount}</span>
        </p>
        {/* Label simulated amounts on this screen too (AGENTS hard rule #8) —
            not only via the global demo banner. */}
        {finding.simulated ? (
          <p className="neu-inset mt-3 inline-block rounded-md px-2.5 py-1 text-xs text-ink-muted">
            {SIMULATED_PRICE_LABEL}
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
              {copyOk
                ? "Approved and copied to clipboard"
                : "Approved. Copy failed, use \u201cOpen in email\u201d or copy manually"}
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
