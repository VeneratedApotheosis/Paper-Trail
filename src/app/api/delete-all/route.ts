import { NextRequest, NextResponse } from "next/server";
import type { DeleteAllResponse } from "@/lib/api/types";
import { deleteAll } from "@/lib/store";
import { authConfig, SESSION_COOKIE, TRANSACTION_COOKIE } from "@/lib/auth/config";
import { sessionUser } from "@/lib/auth/service";
import { authStore } from "@/lib/auth/store";
import { revokeUserAuthorization } from "@/lib/auth/revoke";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per-request authorization: never register a user's credentials globally. */
export async function POST(request: Request): Promise<Response> {
  const req = new NextRequest(request);
  const headers = { "Cache-Control": "no-store" };
  const origin = req.headers.get("origin");
  if ((origin && origin !== req.nextUrl.origin) || req.headers.get("sec-fetch-site") === "cross-site") {
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
    userId = sessionUser(cookie, config);
    if (!userId || !authStore().find(userId)) {
      return NextResponse.json({ error: "Reconnect Gmail before deleting connected account data." }, { status: 401, headers });
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
