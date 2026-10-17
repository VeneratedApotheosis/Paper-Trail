import { NextRequest } from "next/server";
import { authConfig, SESSION_COOKIE } from "@/lib/auth/config";
import { sessionUser } from "@/lib/auth/service";
import { authStore } from "@/lib/auth/store";
import { withStoreScope } from "@/lib/store";

/** Keep anonymous synthetic/upload state distinct from authenticated account data. */
export function withAccountStore<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    const respond = async () => {
      const response = await handler(...args);
      response.headers.set("Cache-Control", "no-store");
      return response;
    };
    const request = args[0];
    if (!(request instanceof Request)) return respond();
    const cookie = new NextRequest(request.url, { headers: request.headers }).cookies.get(SESSION_COOKIE)?.value;
    if (cookie === undefined) return respond();
    let userId: string | null;
    try {
      userId = sessionUser(cookie, authConfig());
      if (userId && !authStore().find(userId)?.tokenEnc) userId = null;
    } catch {
      return Response.json({ error: "Authentication unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    if (!userId) return Response.json({ error: "Reconnect Gmail.", reconnectUrl: "/api/auth/google" },
      { status: 401, headers: { "Cache-Control": "no-store" } });
    return withStoreScope(userId, respond);
  };
}
