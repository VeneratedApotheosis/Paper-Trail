import { authConfig } from "@/lib/auth/config";
import { listAccountGrants } from "@/lib/auth/account";
import { AuthError } from "@/lib/auth/google";
import { getAccessToken } from "@/lib/auth/service";
import { resolveSessionUser } from "@/lib/auth/session";
import { authStore } from "@/lib/auth/store";
import { appendAudit } from "@/lib/store";
import type { GmailAccountTarget } from "./accounts";
import { GmailError } from "./client";

/**
 * The signed-in profile's Gmail accounts for a preview/sync request (#114). `accountId` limits it to one account
 * (404 `account_not_found` when it is not the profile's); by default every account is targeted, expired ones included
 * so they can be reported. A connected account is needed somewhere (withAccountStore requires one first).
 */
export function gmailRequest(request: Request, accountId?: string): { userId: string; accounts: GmailAccountTarget[] } {
  const userId = resolveSessionUser(request, { requireToken: true });
  if (!userId) throw new AuthError("token_expired");
  const config = authConfig();
  const grants = listAccountGrants(userId, config, authStore());
  if (accountId !== undefined && !grants.some(grant => grant.id === accountId)) throw new GmailError(404, "account_not_found");
  return {
    userId,
    accounts: grants.filter(grant => accountId === undefined || grant.id === accountId).map(grant => ({
      id: grant.id,
      mailbox: grant.mailbox,
      connected: grant.connected,
      active: () => Boolean(authStore().findAccount(userId, grant.id)?.tokenEnc),
      deps: {
        accessToken: () => getAccessToken(userId, config, authStore(), fetch, Date.now(), grant.id), signal: request.signal,
        audit(action, meta) {
          authStore().audit(action, userId, { ...meta, accountId: grant.id });
          const where = grants.length > 1 ? ` [${grant.mailbox ?? "account"}]` : "";
          appendAudit({ at: new Date().toISOString(), type: "gmail_fetch",
            detail: `${meta.endpoint} attempt ${meta.attempt}${meta.messageId ? ` message ${meta.messageId}` : ""}${where}` });
        },
      },
    })),
  };
}export function gmailErrorResponse(error: unknown): Response {
  const headers = { "Cache-Control": "no-store" };
  if ((error instanceof AuthError && error.reason === "token_expired") ||
      (error instanceof GmailError && error.status === 401)) {
    return Response.json({ error: "Reconnect Gmail before syncing.", code: "token_expired", reconnectUrl: "/api/auth/google" }, { status: 401, headers });
  }
  if (error instanceof GmailError) return Response.json({ error: "Gmail sync did not complete. Try again.", code: error.code }, { status: error.status, headers });
  return Response.json({ error: "Gmail sync is unavailable. Check the server configuration and try again.", code: "sync_unavailable" }, { status: 503, headers });
}
