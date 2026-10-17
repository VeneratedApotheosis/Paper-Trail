import { withAccountStore } from "@/lib/gmail/context";
import { z } from "zod";
import { getClaimContext, getStoredClaimDraft } from "@/lib/api/claims";
import { decodeId, jsonError } from "@/lib/api/http";
import type { ClaimApproveResponse, ClaimDraftRecord } from "@/lib/api/types";
import { clipboardText, mailtoUrl } from "@/lib/claims";
import { appendAudit, setFindingStatus, upsertDraft } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FindingIdSchema = z.string().min(1).max(300);

/**
 * Records the user's explicit approval of the stored draft and returns the copy / mailto hand-off.
 * Never sends anything (AGENTS.md rule 2). The audit entry names the draft and finding, never the body text.
 */
async function handlePOST(
  _request: Request,
  { params }: { params: Promise<{ findingId: string }> },
): Promise<Response> {
  const parsed = FindingIdSchema.safeParse(decodeId((await params).findingId));
  if (!parsed.success) return jsonError(400, "Invalid finding id");
  const findingId = parsed.data;
  const claim = getClaimContext(findingId);
  if (!claim) return jsonError(404, "Finding not found");
  const stored = getStoredClaimDraft(findingId);
  if (!stored) return jsonError(409, "No claim draft to approve yet; open it with GET /api/claims/:findingId first");

  const at = new Date().toISOString();
  const draft: ClaimDraftRecord = { ...stored, approvedAt: at };
  upsertDraft(draft);
  setFindingStatus(findingId, "drafted");
  appendAudit({
    at,
    type: "approval",
    detail: `Approved claim draft ${draft.id} for finding ${findingId} (${draft.kind}${draft.edited ? ", edited by user" : ""}); handed off for the user to copy or send, nothing sent by PaperTrail`,
  });
  const body: ClaimApproveResponse = { draft, mailtoUrl: mailtoUrl(draft), clipboardText: clipboardText(draft) };
  return Response.json(body);
}

export const POST = withAccountStore(handlePOST);
