import { NextResponse } from "next/server";
import { authConfig, TRANSACTION_COOKIE } from "@/lib/auth/config";
import { beginAuthorization } from "@/lib/auth/service";

export const runtime = "nodejs";
export async function GET() {
  try {
    const config = authConfig();
    const flow = beginAuthorization(config);
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
