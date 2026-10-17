import { NextRequest, NextResponse } from "next/server";
import { authConfig, SESSION_COOKIE, SESSION_SECONDS, TRANSACTION_COOKIE } from "@/lib/auth/config";
import { finishAuthorization } from "@/lib/auth/service";
import { authStore } from "@/lib/auth/store";
import { AuthError } from "@/lib/auth/google";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  let config;
  try { config = authConfig(); }
  catch { return NextResponse.json({ error: "Authentication is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
  let response: NextResponse;
  try {
    const session = await finishAuthorization(request.nextUrl.searchParams,
      request.cookies.get(TRANSACTION_COOKIE)?.value, config, authStore());
    response = NextResponse.redirect(new URL("/sync", config.origin));
    response.cookies.set(SESSION_COOKIE, session, { httpOnly: true, secure: config.secure,
      sameSite: "lax", path: "/", maxAge: SESSION_SECONDS });
  } catch (error) {
    const reason = error instanceof AuthError ? error.reason : "oauth_failed";
    // The existing UI supports token_expired. Other errors return to the consent
    // screen; do not falsely describe every denial as a missing test user.
    response = NextResponse.redirect(new URL(`/connect?error=${reason}`, config.origin));
  }
  response.cookies.set(TRANSACTION_COOKIE, "", { httpOnly: true, secure: config.secure,
    sameSite: "lax", path: "/api/auth", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
