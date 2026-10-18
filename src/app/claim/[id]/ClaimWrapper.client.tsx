"use client";

import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ErrorState } from "@/components/states";
import { ClaimView } from "@/components/views/ClaimView";
import { useApproveClaim, useSaveClaim } from "@/hooks";
import type { ClaimResponse } from "@/lib/api/types";
import { saveThenApproveClaim, type ApproveClaimOutcome } from "./approveClaimFlow";

// Client boundary for /claim/[id] (#67): the server page passes the stored draft; this wrapper owns the approve action
// (save edits -> approve -> copy, see approveClaimFlow.ts) and feeds the props-only ClaimView. `confirmed` (the view's
// "Approved and copied" banner) is set only after all three steps succeeded.

type Notice = Exclude<ApproveClaimOutcome["status"], "approved"> | "approve_first";

async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export function ClaimWrapper({
  claim,
  simulatedLabel,
  demo,
}: {
  claim: ClaimResponse;
  simulatedLabel: string;
  demo: boolean;
}) {
  const findingId = claim.finding.id;
  const save = useSaveClaim();
  const approve = useApproveClaim();
  const [confirmed, setConfirmed] = useState(false);
  const [approvedMailtoUrl, setApprovedMailtoUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const inFlight = useRef(false);

  // TEMPORARY guard for hard rule 2 until ClaimView takes approved/mailtoUrl props (#101); delete when that lands.
  // ClaimView always renders an "Open in email" link built from its local text. Before a successful approval the
  // click is blocked; after it, the click opens the server's mailtoUrl (the approved text), never the local one.
  useEffect(() => {
    function onMailtoClick(event: MouseEvent) {
      const link = event.target instanceof Element ? event.target.closest('a[href^="mailto:"]') : null;
      if (!link) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.type !== "click") return;
      if (approvedMailtoUrl) window.location.assign(approvedMailtoUrl);
      else setNotice("approve_first");
    }
    document.addEventListener("click", onMailtoClick, true);
    document.addEventListener("auxclick", onMailtoClick, true);
    return () => {
      document.removeEventListener("click", onMailtoClick, true);
      document.removeEventListener("auxclick", onMailtoClick, true);
    };
  }, [approvedMailtoUrl]);

  async function handleApprove(edited: { subject: string; body: string }) {
    if (inFlight.current) return;
    inFlight.current = true;
    // Saving clears any earlier approval on the server, so the page drops it too until the new approval succeeds.
    setConfirmed(false);
    setApprovedMailtoUrl(null);
    setNotice(null);
    try {
      const outcome = await saveThenApproveClaim(
        { ...edited, recipient: claim.draft.recipient },
        {
          save: (edits) => save.run(findingId, edits),
          approve: () => approve.run(findingId),
          copy: copyToClipboard,
        },
      );
      if (outcome.status === "approved" || outcome.status === "copy_failed") setApprovedMailtoUrl(outcome.mailtoUrl);
      if (outcome.status === "approved") setConfirmed(true);
      else setNotice(outcome.status);
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <AppShell demo={demo}>
      <ClaimView
        finding={claim.finding}
        order={claim.order}
        draft={claim.draft}
        simulatedLabel={simulatedLabel}
        onApprove={handleApprove}
        confirmed={confirmed}
      />
      {notice === "approve_first" ? (
        <ErrorState
          title="Approve the draft to open it in email"
          what="Your email app opens only after you approve this draft on this page."
          fix="Approving logs it to your audit trail. You still send the email yourself."
        />
      ) : null}
      {notice === "save_failed" ? (
        <ErrorState
          title="Couldn't save your edits"
          what={save.error}
          fix="Nothing was approved or copied. Check the subject and message, then approve again."
        />
      ) : null}
      {notice === "approve_failed" ? (
        <ErrorState
          title="Couldn't approve the claim"
          what={approve.error}
          fix="Your edits were saved, but nothing was approved or copied. Try approving again."
        />
      ) : null}
      {notice === "copy_failed" ? (
        <ErrorState
          title="Approved, but not copied"
          what="The approval is logged to your audit trail, but the browser blocked the clipboard."
          fix="Use Open in email, or select the message and copy it yourself."
        />
      ) : null}
    </AppShell>
  );
}
