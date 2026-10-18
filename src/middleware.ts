import { NextResponse, type NextRequest } from "next/server";
import { ANON_COOKIE, ANON_COOKIE_MAX_AGE_SECONDS, anonymousScope } from "@/lib/store/anonymous";

/**
 * Gives every browser its own anonymous store scope (#90) before any page or API call runs, so the first page load
 * and its parallel API calls share one id and one visitor's demo/upload ledger is never visible to another.
 */
export function middleware(request: NextRequest): NextResponse {
  if (anonymousScope(request.cookies.get(ANON_COOKIE)?.value)) return NextResponse.next();
  const id = crypto.randomUUID();
  request.cookies.set(ANON_COOKIE, id);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(ANON_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: ANON_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icons/|sw.js|swe-worker-|manifest.webmanifest|favicon.ico).*)"],
};
