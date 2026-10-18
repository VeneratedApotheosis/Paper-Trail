import { withAccountStore } from "@/lib/gmail/context";
import { decodeId, jsonError, readJsonBody } from "@/lib/api/http";
import { isValidRouteId } from "@/lib/api/ids";
import { getOrder } from "@/lib/store";
import { DisputeRequestSchema, draftDispute } from "@/lib/disputes/draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Draft only. No persistence, approval, LLM, mailto handoff, email send or owed-total mutation. */
async function handlePOST(request: Request, context: { params: Promise<{ orderId: string }> }): Promise<Response> {
  const id = decodeId((await context.params).orderId);
  if (!isValidRouteId(id)) return jsonError(400, "Invalid order id");
  const parsed = await readJsonBody(request, DisputeRequestSchema);
  if (!parsed.ok) return parsed.response;
  const order = getOrder(id);
  if (!order) return jsonError(404, "Purchase not found");
  const result = draftDispute(order, parsed.data);
  return result.ok ? Response.json({ draft: result.draft }) : jsonError(422, result.message);
}
export const POST = withAccountStore(handlePOST);
