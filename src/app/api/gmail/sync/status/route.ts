import { getSession } from "@/lib/auth/session";
import { AuthError } from "@/lib/auth/google";
import { gmailErrorResponse } from "@/lib/gmail/http";
import { gmailProgress } from "@/lib/gmail/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Polling is local-only: no token refresh, Google fetch, or account-store mutation. */
export async function GET(request: Request): Promise<Response> {
  try {
    const session = await getSession(request);
    if (!session?.gmailConnected) throw new AuthError("token_expired");
    return Response.json(gmailProgress.read(session.userId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return gmailErrorResponse(error); }
}
