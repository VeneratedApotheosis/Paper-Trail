import { withAccountStore } from "@/lib/gmail/context";
import { getState } from "@/lib/store";
import { orderNeedsReview } from "@/lib/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handleGET(request: Request): Promise<Response> {
  void request;
  const state = getState();
  return Response.json({ orders: state.orders.filter(orderNeedsReview), items: state.reviewQueue });
}
export const GET = withAccountStore(handleGET);
