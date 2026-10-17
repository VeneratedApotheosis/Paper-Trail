import { withAccountStore } from "@/lib/gmail/context";
import { decodeId } from "@/lib/api/http";
import { ConfirmRequestSchema } from "@/lib/review/schema";
import { confirmReviewedOrder } from "@/lib/review/service";
import { reviewError, reviewOriginAllowed, reviewResponse } from "@/lib/review/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handlePOST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!reviewOriginAllowed(request)) return Response.json({ error: "Confirm orders from this app." }, { status: 403 });
  const parsed = ConfirmRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Explicit confirmation and current revision are required." }, { status: 400 });
  try {
    return reviewResponse(confirmReviewedOrder(decodeId((await context.params).id), parsed.data.revision));
  } catch (error) { return reviewError(error); }
}
export const POST = withAccountStore(handlePOST);
