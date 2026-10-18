import { withAccountStore } from "@/lib/gmail/context";
import { listPromotions } from "@/lib/promotions/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/promotions[?include=expired]: offers read from marketing emails (#131), `{ promotions, total, asOf, expiredHidden,
 * enriching }`. Soonest expiry first, no-expiry last; expired ones are left out unless `include=expired`.
 */
async function handleGET(request: Request): Promise<Response> {
  const includeExpired = new URL(request.url).searchParams.get("include") === "expired";
  return Response.json(listPromotions({ includeExpired }), { headers: { "Cache-Control": "no-store" } });
}

export const GET = withAccountStore(handleGET);