import { buildLedgerResponse } from "@/lib/api/ledger";
import { decodeId, jsonError } from "@/lib/api/http";
import { withAccountStore } from "@/lib/gmail/context";
import { markNotReceipt } from "@/lib/quality/feedback";
import { qualityErrorResponse, qualityOriginAllowed } from "@/lib/quality/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/quality/skipped/:emailId/not-receipt: "not a receipt" for an email that became an order or review item. */
async function handlePOST(request: Request, context: { params: Promise<{ emailId: string }> }): Promise<Response> {
  if (!qualityOriginAllowed(request)) return jsonError(403, "Send feedback from this app.");
  try {
    const result = await markNotReceipt(decodeId((await context.params).emailId));
    return Response.json({ ...result, summary: buildLedgerResponse().summary });
  } catch (error) {
    return qualityErrorResponse(error);
  }
}

export const POST = withAccountStore(handlePOST);
