"use client";

import { useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ErrorState } from "@/components/states";
import { ClaimView } from "@/components/views/ClaimView";
import { useApproveClaim, useSaveClaim, useSetFindingStatus } from "@/hooks";
import type { ClaimResponse } from "@/lib/api/types";
import { saveThenApproveClaim, type ApproveClaimOutcome } from "./approveClaimFlow";

// Client boundary for /claim/[id] (#67): the server page passes the stored draft; this wrapper owns the approve action
// (save edits -> approve -> copy, see approveClaimFlow.ts) and feeds the props-only ClaimView. `confirmed` (the view's
// "Approved and copied" banner) is set only after all three steps succeeded.

type Notice = Exclude<ApproveClaimOutcome["status"], "approved">;

async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export function ClaimWrapper({
  claim,
  simulatedLabel,
  demo, initialMailtoUrl,
}: {
  claim: ClaimResponse;
  simulatedLabel: string;
  demo: boolean;
  initialMailtoUrl?: string | null;
}) {
  const findingId = claim.finding.id;
  const save = useSaveClaim();
  const statusChange = useSetFindingStatus();
  const [findingStatus, setFindingStatus] = useState(claim.finding.status);
  const approve = useApproveClaim();
  const [currentDraft, setCurrentDraft] = useState(claim.draft);
  const [approved, setApproved] = useState(Boolean(claim.draft.approvedAt));
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [pending, setPending] = useState(false);
  const [approvedMailtoUrl, setApprovedMailtoUrl] = useState<string | null>(initialMailtoUrl ?? null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const inFlight = useRef(false);

  async function handleApprove(edited: { subject: string; body: string; recipient: string }) {
    if (inFlight.current) return;
    inFlight.current = true;
    // Saving clears any earlier approval on the server, so the page drops it too until the new approval succeeds.
    setApproved(false);
    setPending(true);
    setCopyStatus("idle");
    setApprovedMailtoUrl(null);
    setNotice(null);
    try {
      const outcome = await saveThenApproveClaim(
        edited,
        {
          save: (edits) => save.run(findingId, edits),
          approve: async () => {
            const result = await approve.run(findingId);
            if (result) { setCurrentDraft(result.draft); setApproved(true); }
            return result;
          },
          copy: copyToClipboard,
        },
      );
      if (outcome.status === "approved" || outcome.status === "copy_failed") setApprovedMailtoUrl(outcome.mailtoUrl);
      if (outcome.status === "approved") setCopyStatus("copied");
      else { setNotice(outcome.status); if (outcome.status === "copy_failed") setCopyStatus("failed"); }
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <AppShell demo={demo}>
      <ClaimView
        finding={claim.finding}
        order={claim.order}
        draft={currentDraft}
        simulatedLabel={simulatedLabel}
        onApprove={handleApprove}
        approved={approved}
        approvedAt={currentDraft.approvedAt}
        mailtoUrl={approvedMailtoUrl}
        copyStatus={copyStatus}
        pending={pending || save.pending || statusChange.pending}
        findingStatus={findingStatus}
        onSetStatus={async status => { const result = await statusChange.run(findingId, status); if (result) setFindingStatus(result.finding.status); }}
        onSave={async edited => {
          setApproved(false); setApprovedMailtoUrl(null); setCopyStatus("idle");
          const result = await save.run(findingId, edited);
          if (result) setCurrentDraft(result.draft);
        }}
        error={save.error ?? approve.error ?? statusChange.error}
        warnings={currentDraft.warnings}
        note={currentDraft.note}
        recipientVerified={currentDraft.recipientVerified}
      />
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
