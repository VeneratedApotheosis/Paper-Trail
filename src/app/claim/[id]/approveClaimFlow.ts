import type { ClaimApproveResponse, ClaimEditRequest, ClaimResponse } from "@/lib/api/types";

/**
 * Approve flow for the claim page (#67). The user's current edits are saved first (PUT), then the stored draft is
 * approved, then the server's `clipboardText` is copied. Each step runs only after the previous one succeeded, so the
 * page never shows "approved" or "copied" for something that didn't happen. `mailtoUrl` always comes from the approve
 * response; nothing is sent (AGENTS.md hard rule 2).
 */

export interface ApproveClaimSteps {
  /** PUT /api/claims/:findingId; null when it failed. */
  save: (edits: ClaimEditRequest) => Promise<ClaimResponse | null>;
  /** POST /api/claims/:findingId/approve; null when it failed. */
  approve: () => Promise<ClaimApproveResponse | null>;
  /** Clipboard write; rejects when the browser refuses it. */
  copy: (text: string) => Promise<void>;
}

export type ApproveClaimOutcome =
  /** Saved, approved (audited, finding now "drafted") and copied. */
  | { status: "approved"; mailtoUrl: string }
  /** Saved and approved, but the clipboard write failed: nothing was copied. */
  | { status: "copy_failed"; mailtoUrl: string }
  /** The edits were not saved; nothing was approved. */
  | { status: "save_failed" }
  /** The edits were saved, but the approval failed. */
  | { status: "approve_failed" };

export async function saveThenApproveClaim(
  edits: ClaimEditRequest,
  steps: ApproveClaimSteps,
): Promise<ApproveClaimOutcome> {
  const saved = await steps.save(edits);
  if (!saved) return { status: "save_failed" };
  const approved = await steps.approve();
  if (!approved) return { status: "approve_failed" };
  try {
    await steps.copy(approved.clipboardText);
  } catch {
    return { status: "copy_failed", mailtoUrl: approved.mailtoUrl };
  }
  return { status: "approved", mailtoUrl: approved.mailtoUrl };
}
