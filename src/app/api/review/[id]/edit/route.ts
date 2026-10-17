import { withAccountStore } from "@/lib/gmail/context";
import { decodeId } from "@/lib/api/http";
import { EditRequestSchema } from "@/lib/review/schema";
import { editReviewedOrder } from "@/lib/review/service";
import { reviewError, reviewOriginAllowed, reviewResponse } from "@/lib/review/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handlePOST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!reviewOriginAllowed(request)) return Response.json({ error: "Save corrections from this app." }, { status: 403 });
  const parsed = EditRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid review correction." }, { status: 400 });
  try {
    return reviewResponse(editReviewedOrder(decodeId((await context.params).id), parsed.data.revision, parsed.data.edit));
  } catch (error) { return reviewError(error); }
}
export const POST = withAccountStore(handlePOST);
