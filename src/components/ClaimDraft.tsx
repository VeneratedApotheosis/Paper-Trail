"use client";

import { useState } from "react";
import type { Finding, FindingKind, NormalizedOrder } from "@/lib/contracts";
import type { Draft } from "@/lib/types";
import { ClaimView } from "@/components/views/ClaimView";
import { formatMoney } from "@/lib/format";
import { merchantName } from "@/lib/view";

// Thin client wrapper for the claim sheet (#17). The server page hands it the
// finding/order/existing draft; this component builds a fallback draft when the
// backend hasn't produced one and owns the approve/copy action, then renders the
// props-only <ClaimView/>. No data-layer imports (@/lib/mock|api|store) live
// here: simulatedLabel arrives as a prop so the wrapper stays decoupled.

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
  simulatedLabel,
}: {
  finding: Finding;
  order: NormalizedOrder;
  existingDraft: Draft | undefined;
  simulatedLabel: string;
}) {
  // Signed name: drafted name first, then the receipt's customer name, then a
  // Google-profile-name fallback (we have no profile wired up in the demo).
  const signedName =
    existingDraft?.signedName ?? order.customerName ?? "PaperTrail user";
  const recipient = existingDraft?.recipient ?? fallbackRecipient(order);

  // Prefer an existing backend draft; otherwise synthesize one client-side so
  // ClaimView always receives a complete Draft.
  const draft: Draft =
    existingDraft ?? {
      id: `draft-fallback:${finding.id}`,
      findingId: finding.id,
      recipient,
      signedName,
      ...buildFallbackDraft(finding, order, signedName),
    };

  const [confirmed, setConfirmed] = useState(false);

  async function handleApprove(edited: { subject: string; body: string }) {
    const clipboardText = `Subject: ${edited.subject}\n\n${edited.body}`;
    try {
      await navigator.clipboard.writeText(clipboardText);
    } catch {
      // Clipboard may be unavailable (permissions / insecure context). We still
      // record the approval; the user can copy manually or use "Open in email".
    }
    setConfirmed(true);
    // Production: write an audit row (type "approval") through the claims API
    // (team-owned) — approvals must be audited (AGENTS.md hard rule #6).
  }

  return (
    <ClaimView
      finding={finding}
      order={order}
      draft={draft}
      simulatedLabel={simulatedLabel}
      onApprove={handleApprove}
      confirmed={confirmed}
    />
  );
}
