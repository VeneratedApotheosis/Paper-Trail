import { withAccountStore } from "@/lib/gmail/context";
import { getQualityReports } from "@/lib/quality/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/quality: the latest sync quality report and the capped history (oldest first) of this account. */
async function handleGET(_request: Request): Promise<Response> {
  void _request;
  return Response.json(getQualityReports(), { headers: { "Cache-Control": "no-store" } });
}

export const GET = withAccountStore(handleGET);
