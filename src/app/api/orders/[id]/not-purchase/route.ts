import { buildLedgerResponse } from "@/lib/api/ledger";
import { decodeId, jsonError } from "@/lib/api/http";
import { withAccountStore } from "@/lib/gmail/context";
import { qualityErrorResponse, qualityOriginAllowed } from "@/lib/quality/http";
import { markOrderNotPurchase } from "@/lib/quality/purchase-feedback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/orders/:id/not-purchase: the order is not a purchase (a false positive). Every email of the order is saved
 * as "not a receipt" (a label that holds across syncs of any account and restarts), the order and its findings leave
 * the ledger, owed is recomputed and one audit row is written. Undo: POST /api/orders/:id/restore.
 */
async function handlePOST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!qualityOriginAllowed(request)) return jsonError(403, "Send feedback from this app.");
  try {
    const result = markOrderNotPurchase(decodeId((await context.params).id));
    return Response.json({ ...result, summary: buildLedgerResponse().summary });
  } catch (error) {
    return qualityErrorResponse(error);
  }
}

export const POST = withAccountStore(handlePOST);
