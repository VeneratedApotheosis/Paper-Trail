import { buildLedgerResponse } from "@/lib/api/ledger";
import { decodeId, jsonError } from "@/lib/api/http";
import { withAccountStore } from "@/lib/gmail/context";
import { qualityErrorResponse, qualityOriginAllowed } from "@/lib/quality/http";
import { restoreOrder } from "@/lib/quality/purchase-feedback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/orders/:id/restore: undoes "not a purchase" (whole order, or one email) while the server still holds what was
 * removed: the order comes back and its labels are removed. 404 once that is gone (restart, upload, delete-all).
 */
async function handlePOST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!qualityOriginAllowed(request)) return jsonError(403, "Send feedback from this app.");
  try {
    const result = restoreOrder(decodeId((await context.params).id));
    return Response.json({ ...result, summary: buildLedgerResponse().summary });
  } catch (error) {
    return qualityErrorResponse(error);
  }
}

export const POST = withAccountStore(handlePOST);
