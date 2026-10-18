import { NextResponse } from "next/server";
import { authConfig, TRANSACTION_COOKIE } from "./config";
import { beginAuthorization } from "./service";

/**
 * Redirect to Google's consent screen with the PKCE transaction cookie. `link: true` (#114) asks Google to choose an
 * account and makes the callback add that mailbox to the signed-in profile instead of switching to it.
 */
export function startAuthorization(link: boolean): NextResponse {
  try {
    const config = authConfig();
    const flow = beginAuthorization(config, Date.now(), { link });
    const response = NextResponse.redirect(flow.url);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.cookies.set(TRANSACTION_COOKIE, flow.cookie, {
      httpOnly: true, secure: config.secure, sameSite: "lax", path: "/api/auth", maxAge: 600,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Authentication is not configured. Ask a teammate to check the server configuration." },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
