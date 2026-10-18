import { withAccountStore } from "@/lib/gmail/context";
import { getSkippedEmails } from "@/lib/quality/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/quality/skipped: emails that produced no order (safe metadata only: sender name + domain, subject, reason). */
async function handleGET(_request: Request): Promise<Response> {
  void _request;
  const skipped = getSkippedEmails();
  return Response.json({ skipped, total: skipped.length }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = withAccountStore(handleGET);
