import { sameOriginAllowed } from "@/lib/http/same-origin";
import { withAccountStore } from "@/lib/gmail/context";
import { NextRequest, NextResponse } from "next/server";
import type { DeleteAllResponse } from "@/lib/api/types";
import { deleteAll } from "@/lib/store";
import { authConfig, SESSION_COOKIE, TRANSACTION_COOKIE } from "@/lib/auth/config";
import { clearAuthCookies, resolveSessionUser } from "@/lib/auth/session";
import { authStore } from "@/lib/auth/store";
import { revokeUserAuthorization } from "@/lib/auth/revoke";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per-request authorization: never register a user's credentials globally. */
async function handlePOST(request: Request): Promise<Response> {
  const req = new NextRequest(request);
  const headers = { "Cache-Control": "no-store" };
  if (!sameOriginAllowed(req)) {
    return NextResponse.json({ error: "Delete everything must be requested from this app." }, { status: 403, headers });
  }
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  let config: ReturnType<typeof authConfig> | undefined;
  let userId: string | null = null;
  if (cookie !== undefined) {
    try { config = authConfig(); }
    catch {
      return NextResponse.json({ error: "Authentication is not configured; deletion was not performed." }, { status: 503, headers });
    }
    // #84: a valid sealed identity with an existing account row may delete even if its Gmail grant expired
    // or was revoked (tokenEnc cleared). Tampered / expired / deleted identities are rejected and their
    // cookies cleared, so a stale cookie can't block the anonymous demo afterwards.
    userId = resolveSessionUser(request, { requireToken: false });
    if (!userId) {
      const rejected = NextResponse.json(
        { error: "Your session is no longer valid. Reconnect Gmail to delete connected account data." },
        { status: 401, headers },
      );
      return clearAuthCookies(rejected, request);
    }
  }
  // Anonymous demo deletion must never invoke a global revoker belonging to an
  // authenticated browser. Body/query user ids are intentionally ignored.
  const revoke = userId && config
    ? () => revokeUserAuthorization(userId, config, authStore())
    : null;
  const body: DeleteAllResponse = await deleteAll(undefined, revoke);
  const response = NextResponse.json(body, { headers });
  const secure = config?.secure ?? req.nextUrl.protocol === "https:";
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0 });
  response.cookies.set(TRANSACTION_COOKIE, "", { httpOnly: true, secure, sameSite: "lax", path: "/api/auth", maxAge: 0 });
  return response;
}

export const POST = withAccountStore(handlePOST, { requireToken: false });
