import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/config";
import { ANON_COOKIE, ANON_COOKIE_MAX_AGE_SECONDS, anonymousScope } from "@/lib/store/anonymous";

/**
 * Gives every browser its own anonymous store scope (#90) before any page or API call runs, so the first page load
 * and its parallel API calls share one id and one visitor's demo/upload ledger is never visible to another.
 */
/** Set by POST /api/demo (cleared by DELETE): lets the synthetic demo count as "in the app" for routing. */
export const DEMO_COOKIE = "papertrail_demo";

const PUBLIC_PAGES = ["/welcome", "/~offline"];

/**
 * Routing only (not security; the APIs enforce real access): signed-out visitors (no Gmail session, no demo) see the
 * landing page for every page URL; signed-in visitors never see it and go to the dashboard.
 */
function routeRedirect(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) return null;
  const inApp = Boolean(request.cookies.get(SESSION_COOKIE)?.value || request.cookies.get(DEMO_COOKIE)?.value);
  const isPublic = PUBLIC_PAGES.includes(pathname);
  if (!inApp && !isPublic) return NextResponse.redirect(new URL("/welcome", request.url));
  if (inApp && pathname === "/welcome") return NextResponse.redirect(new URL("/", request.url));
  return null;
}

export function middleware(request: NextRequest): NextResponse {
  const redirect = routeRedirect(request);
  if (redirect) return redirect;
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
