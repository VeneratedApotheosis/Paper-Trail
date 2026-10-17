import { NextRequest } from "next/server";
import { authConfig, SESSION_COOKIE } from "@/lib/auth/config";
import { AuthError } from "@/lib/auth/google";
import { getAccessToken, sessionUser } from "@/lib/auth/service";
import { authStore } from "@/lib/auth/store";
import { appendAudit } from "@/lib/store";
import { GmailError, type GmailDeps } from "./client";

export function gmailRequest(request: Request): { userId: string; deps: GmailDeps; active: () => boolean } {
  const cookie = new NextRequest(request.url, { headers: request.headers }).cookies.get(SESSION_COOKIE)?.value;
  if (!cookie) throw new AuthError("token_expired");
  const config = authConfig();
  const userId = sessionUser(cookie, config);
  if (!userId || !authStore().find(userId)?.tokenEnc) throw new AuthError("token_expired");
  return {
    userId,
    active: () => Boolean(authStore().find(userId)?.tokenEnc),
    deps: {
      accessToken: () => getAccessToken(userId, config, authStore()), signal: request.signal,
      audit(action, meta) {
        authStore().audit(action, userId, meta);
        appendAudit({ at: new Date().toISOString(), type: "gmail_fetch",
          detail: `${meta.endpoint} attempt ${meta.attempt}${meta.messageId ? ` message ${meta.messageId}` : ""}` });
      },
    },
  };
}
export function gmailErrorResponse(error: unknown): Response {
  const headers = { "Cache-Control": "no-store" };
  if ((error instanceof AuthError && error.reason === "token_expired") ||
      (error instanceof GmailError && error.status === 401)) {
    return Response.json({ error: "Reconnect Gmail before syncing.", code: "token_expired", reconnectUrl: "/api/auth/google" }, { status: 401, headers });
  }
  if (error instanceof GmailError) return Response.json({ error: "Gmail sync did not complete. Try again.", code: error.code }, { status: error.status, headers });
  return Response.json({ error: "Gmail sync is unavailable. Check the server configuration and try again.", code: "sync_unavailable" }, { status: 503, headers });
}
