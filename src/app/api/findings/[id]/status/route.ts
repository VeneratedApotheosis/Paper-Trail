import { withAccountStore } from "@/lib/gmail/context";
import { z } from "zod";
import { decodeId, jsonError, readJsonBody } from "@/lib/api/http";
import { FINDING_STATUS_UPDATES, type FindingStatusResponse } from "@/lib/api/types";
import { computeOwed } from "@/lib/rules/owed";
import { appendAudit, getFinding, getState, setFindingStatus } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IdSchema = z.string().min(1).max(300);
const StatusBodySchema = z.object({ status: z.enum(FINDING_STATUS_UPDATES) });

/**
 * Sets a finding's status by hand (#77): `resolved` (the money came back), `dismissed` (not worth claiming) or
 * `open` (undo). Open and drafted findings count toward the owed total; resolved and dismissed drop out.
 * `drafted` is only set by approving a claim. Audited as an `approval` (the user's explicit decision).
 */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const parsedId = IdSchema.safeParse(decodeId((await params).id));
  if (!parsedId.success) return jsonError(400, "Invalid finding id");
  const body = await readJsonBody(request, StatusBodySchema);
  if (!body.ok) return body.response;

  const id = parsedId.data;
  const current = getFinding(id);
  const finding = current && setFindingStatus(id, body.data.status);
  if (!current || !finding) return jsonError(404, "Finding not found");

  appendAudit({
    at: new Date().toISOString(),
    type: "approval",
    detail: `Finding ${id} marked ${body.data.status} (was ${current.status}) by the user`,
  });
  const state = getState();
  const response: FindingStatusResponse = { finding, summary: computeOwed(state.findings, state.orders) };
  return Response.json(response);
}

export const POST = withAccountStore(handlePOST);
