import { NextRequest, NextResponse } from "next/server";
import type { DisconnectResponse } from "@/lib/api/types";
import { authConfig } from "@/lib/auth/config";
import { disconnectUserAuthorization } from "@/lib/auth/revoke";
import { clearAuthCookies, resolveSessionUser } from "@/lib/auth/session";
import { authStore } from "@/lib/auth/store";
import { withAccountStore } from "@/lib/gmail/context";
import { appendAudit } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Disconnect Gmail (#109): revoke the grant (best effort) and clear the stored tokens and mailbox, but keep the
 * signed-in identity and the synced ledger. Gmail routes answer 401 token_expired afterwards until the user reconnects.
 */
async function handlePOST(request: Request): Promise<Response> {
  const req = new NextRequest(request);
  const headers = { "Cache-Control": "no-store" };
  const origin = req.headers.get("origin");
  if ((origin && origin !== req.nextUrl.origin) || req.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Disconnect Gmail must be requested from this app." }, { status: 403, headers });
  }
  let config: ReturnType<typeof authConfig>;
  try { config = authConfig(); }
  catch { return NextResponse.json({ error: "Authentication is not configured." }, { status: 503, headers }); }
  const userId = resolveSessionUser(request, { requireToken: false });
  if (!userId) {
    return clearAuthCookies(NextResponse.json({ error: "Sign in with Gmail first.", reconnectUrl: "/api/auth/google" },
      { status: 401, headers }), request);
  }
  const revokedToken = await disconnectUserAuthorization(userId, config, authStore());
  appendAudit({ at: new Date().toISOString(), type: "approval",
    detail: `Gmail disconnected; ${revokedToken ? "Google grant revoked" : "Google revocation not confirmed"}; ledger kept` });
  const body: DisconnectResponse = { disconnected: true, revokedToken };
  return NextResponse.json(body, { headers });
}

export const POST = withAccountStore(handlePOST);
