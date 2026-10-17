import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { authConfig, SESSION_COOKIE } from "./config";
import { unseal } from "./crypto";
import { storedTokens } from "./google";
import { sessionUser } from "./service";
import { authStore } from "./store";

export type Session = { userId: string; gmailConnected: boolean };

/**
 * Node.js only: uses SQLite and node:crypto. Never import into Edge middleware.
 * Omit request in server components; pass Request/NextRequest in route handlers.
 * Reads current account state on every call (no shared session cache).
 * gmailConnected means a locally valid refresh grant, not verified Google access.
 * No network calls, refreshes, redirects, writes, or credential material returned.
 * Config/DB failures propagate; callers must not silently use anonymous data.
 */
export async function getSession(request?: Request): Promise<Session | null> {
  const cookie = request
    ? new NextRequest(request.url, { headers: request.headers }).cookies.get(SESSION_COOKIE)?.value
    : (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) return null;

  const config = authConfig();
  const now = Date.now();
  const userId = sessionUser(cookie, config, now);
  if (!userId) return null;
  const row = authStore().find(userId);
  if (!row) return null;

  let gmailConnected = false;
  if (row.tokenEnc) {
    try {
      const tokens = storedTokens.parse(unseal(row.tokenEnc, config.key, "tokens"));
      // An expired access token can still be refreshed by the Gmail API service.
      gmailConnected = tokens.refreshExpiresAt === undefined || tokens.refreshExpiresAt > now;
    } catch { /* Corrupt credentials require reconnect; identity remains valid. */ }
  }
  return { userId, gmailConnected };
}
