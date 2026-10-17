import { NextRequest, NextResponse } from "next/server";
import { authConfig, SESSION_COOKIE } from "@/lib/auth/config";
import { getAccessToken, sessionUser } from "@/lib/auth/service";
import { authStore } from "@/lib/auth/store";
import { AuthError } from "@/lib/auth/google";

export const runtime = "nodejs";
// Refresh on the server as needed; this endpoint exposes connection status only.
export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const config = authConfig();
    const userId = sessionUser(request.cookies.get(SESSION_COOKIE)?.value, config);
    if (!userId) return NextResponse.json({ connected: false, reconnectUrl: "/api/auth/google" }, { status: 401, headers });
    await getAccessToken(userId, config, authStore());
    return NextResponse.json({ connected: true }, { headers });
  } catch (error) {
    if (error instanceof AuthError && error.reason === "token_expired") {
      return NextResponse.json({ connected: false, error: "token_expired", reconnectUrl: "/api/auth/google" }, { status: 401, headers });
    }
    return NextResponse.json({ connected: false, error: "auth_unavailable" }, { status: 503, headers });
  }
}
