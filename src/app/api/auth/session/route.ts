import { NextRequest, NextResponse } from "next/server";
import { authConfig } from "@/lib/auth/config";
import { getAccessToken } from "@/lib/auth/service";
import { clearAuthCookies, resolveSessionUser } from "@/lib/auth/session";
import { authStore } from "@/lib/auth/store";
import { AuthError } from "@/lib/auth/google";

export const runtime = "nodejs";
// Refresh on the server as needed; this endpoint exposes connection status only.
export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const config = authConfig();
    const userId = resolveSessionUser(request, { requireToken: false });
    if (!userId) return clearAuthCookies(NextResponse.json({ connected: false, reconnectUrl: "/api/auth/google" }, { status: 401, headers }), request);
    await getAccessToken(userId, config, authStore());
    return NextResponse.json({ connected: true }, { headers });
  } catch (error) {
    if (error instanceof AuthError && error.reason === "token_expired") {
      return NextResponse.json({ connected: false, error: "token_expired", reconnectUrl: "/api/auth/google" }, { status: 401, headers });
    }
    return NextResponse.json({ connected: false, error: "auth_unavailable" }, { status: 503, headers });
  }
}
