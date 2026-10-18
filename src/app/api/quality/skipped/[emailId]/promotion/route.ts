import { decodeId, jsonError } from "@/lib/api/http";
import { withAccountStore } from "@/lib/gmail/context";
import { markSkippedAsPromotion } from "@/lib/quality/feedback";
import { qualityErrorResponse, qualityOriginAllowed } from "@/lib/quality/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/quality/skipped/:emailId/promotion: "this is a promotion". Lists it on the Promotions page and saves a label. */
async function handlePOST(request: Request, context: { params: Promise<{ emailId: string }> }): Promise<Response> {
  if (!qualityOriginAllowed(request)) return jsonError(403, "Send feedback from this app.");
  try {
    return Response.json(markSkippedAsPromotion(decodeId((await context.params).emailId)));
  } catch (error) {
    return qualityErrorResponse(error);
  }
}

export const POST = withAccountStore(handlePOST);