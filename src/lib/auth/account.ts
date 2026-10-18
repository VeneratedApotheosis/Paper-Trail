import type { authConfig } from "./config";
import { seal, unseal } from "./crypto";
import { mailboxIdentity, storedTokens, type Fetcher } from "./google";
import type { AuthStore } from "./store";

export interface GmailAccountStatus {
  /** A locally valid refresh grant exists (not verified with Google). */
  connected: boolean;
  /** Signed in, but the Gmail grant is missing, expired, revoked, disconnected or unreadable: reconnect to sync again. */
  expired: boolean;
  /** Connected address, decrypted from the sealed token blob; null when unknown or not connected. */
  mailbox: string | null;
}

export const anonymousGmailStatus: GmailAccountStatus = { connected: false, expired: false, mailbox: null };

/**
 * Status for a validated session user. Never returns tokens. Rows saved before #109 have no sealed mailbox: when the
 * access token is still valid the address is fetched once from Gmail's profile and re-sealed with the tokens (best
 * effort, a failure just leaves `mailbox: null`).
 */
export async function gmailAccountStatus(userId: string, config: ReturnType<typeof authConfig>, store: AuthStore,
  fetcher: Fetcher = fetch, now = Date.now()): Promise<GmailAccountStatus> {
  const row = store.find(userId);
  if (!row) return anonymousGmailStatus;
  const expired: GmailAccountStatus = { connected: false, expired: true, mailbox: null };
  if (!row.tokenEnc) return expired;
  let tokens;
  try { tokens = storedTokens.parse(unseal(row.tokenEnc, config.key, "tokens")); }
  catch { return expired; }
  const mailbox = tokens.mailbox ?? null;
  if (tokens.refreshExpiresAt !== undefined && tokens.refreshExpiresAt <= now) return { ...expired, mailbox };
  if (mailbox !== null) return { connected: true, expired: false, mailbox };
  if (tokens.expiresAt <= now + 60000) return { connected: true, expired: false, mailbox: null };
  try {
    store.audit("gmail.fetch", userId, { endpoint: "users/me/profile", count: 1 });
    const fetched = await mailboxIdentity(tokens.accessToken, fetcher);
    // Don't overwrite tokens refreshed or cleared (disconnect, delete-all) while the profile request was in flight.
    if (store.find(userId)?.tokenEnc === row.tokenEnc) store.update(userId, seal({ ...tokens, mailbox: fetched }, config.key, "tokens"));
    return { connected: true, expired: false, mailbox: fetched };
  } catch {
    return { connected: true, expired: false, mailbox: null };
  }
}
