import { buildLedgerResponse } from "@/lib/api/ledger";
import { decodeId, jsonError } from "@/lib/api/http";
import { withAccountStore } from "@/lib/gmail/context";
import { qualityErrorResponse, qualityOriginAllowed } from "@/lib/quality/http";
import { markEmailNotAboutOrder } from "@/lib/quality/purchase-feedback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/orders/:id/emails/:emailId/not-about-order: one email of the order is not about this purchase. Only that
 * email's events leave the order (rules run again) and it is saved as "not a receipt". Undo: POST /api/orders/:id/restore.
 */
async function handlePOST(request: Request, context: { params: Promise<{ id: string; emailId: string }> }): Promise<Response> {
  if (!qualityOriginAllowed(request)) return jsonError(403, "Send feedback from this app.");
  try {
    const params = await context.params;
    const result = markEmailNotAboutOrder(decodeId(params.id), decodeId(params.emailId));
    return Response.json({ ...result, summary: buildLedgerResponse().summary });
  } catch (error) {
    return qualityErrorResponse(error);
  }
}

export const POST = withAccountStore(handlePOST);
