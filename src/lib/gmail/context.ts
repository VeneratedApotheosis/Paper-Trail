import { clearAuthCookies, resolveSessionUser, sessionCookie } from "@/lib/auth/session";
import { NextRequest } from "next/server";
import { withStoreScope } from "@/lib/store";
import { ANON_COOKIE, anonymousScope } from "@/lib/store/anonymous";

/**
 * Keep anonymous synthetic/upload state distinct from authenticated account data. The default needs only a valid
 * identity, so an account whose Gmail grant expired or was disconnected (#109) still reads and edits its own ledger;
 * pass `requireToken: true` for routes that call Gmail.
 */
export function withAccountStore<A extends unknown[]>(handler: (...args: A) => Promise<Response>,
  options: { requireToken: boolean } = { requireToken: false }) {
  return async (...args: A): Promise<Response> => {
    const respond = async () => {
      const response = await handler(...args);
      response.headers.set("Cache-Control", "no-store");
      return response;
    };
    const request = args[0];
    if (!(request instanceof Request)) return respond();
    const cookie = sessionCookie(request);
    if (cookie === undefined) {
      // Each anonymous browser has its own store (#90); only cookie-less clients (scripts, route tests) share one.
      const anonymous = anonymousScope(new NextRequest(request.url, { headers: request.headers }).cookies.get(ANON_COOKIE)?.value);
      return anonymous ? withStoreScope(anonymous, respond) : respond();
    }
    let userId: string | null;
    try {
      userId = resolveSessionUser(request, { requireToken: false });
      if (userId && options.requireToken && !resolveSessionUser(request, options)) {
        // Keep the valid identity cookie so delete-all can still purge its scope.
        return Response.json({ error: "Reconnect Gmail.", reconnectUrl: "/api/auth/google" },
          { status: 401, headers: { "Cache-Control": "no-store" } });
      }
    } catch {
      return Response.json({ error: "Authentication unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    if (!userId) return clearAuthCookies(Response.json({ error: "Reconnect Gmail.", reconnectUrl: "/api/auth/google" },
      { status: 401, headers: { "Cache-Control": "no-store" } }), request);
    return withStoreScope(userId, respond);
  };
}
