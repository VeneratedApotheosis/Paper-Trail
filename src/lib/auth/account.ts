import type { authConfig } from "./config";
import { seal, unseal } from "./crypto";
import { mailboxIdentity, storedTokens, type Fetcher } from "./google";
import type { AuthStore, StoredAccount } from "./store";

export interface GmailAccountStatus {
  /** A locally valid refresh grant exists (not verified with Google). */
  connected: boolean;
  /** Signed in, but the Gmail grant is missing, expired, revoked, disconnected or unreadable: reconnect to sync again. */
  expired: boolean;
  /** Connected address, decrypted from the sealed token blob; null when unknown or not connected. */
  mailbox: string | null;
}

/** One Gmail account of the profile (#114): `id` is what `RawEmail.sourceAccount` / `NormalizedOrder.sources` carry. */
export interface LinkedAccountStatus extends GmailAccountStatus {
  id: string;
}

export const anonymousGmailStatus: GmailAccountStatus = { connected: false, expired: false, mailbox: null };

/** Status from the stored credentials alone, no network and no writes. */
function localStatus(account: StoredAccount, key: string, now: number): GmailAccountStatus {
  const expired: GmailAccountStatus = { connected: false, expired: true, mailbox: null };
  if (!account.tokenEnc) return expired;
  let tokens;
  try { tokens = storedTokens.parse(unseal(account.tokenEnc, key, "tokens")); }
  catch { return expired; }
  const mailbox = tokens.mailbox ?? null;
  if (tokens.refreshExpiresAt !== undefined && tokens.refreshExpiresAt <= now) return { ...expired, mailbox };
  return { connected: true, expired: false, mailbox };
}

/** Every Gmail account of a validated session user, own mailbox first. Local only (no network), so safe to poll. */
export function listAccountGrants(userId: string, config: ReturnType<typeof authConfig>, store: AuthStore,
  now = Date.now()): LinkedAccountStatus[] {
  return store.accounts(userId).map(account => ({ id: account.id, ...localStatus(account, config.key, now) }));
}

/** The profile's own mailbox only; see gmailAccountStatuses for all accounts. */
export async function gmailAccountStatus(userId: string, config: ReturnType<typeof authConfig>, store: AuthStore,
  fetcher: Fetcher = fetch, now = Date.now()): Promise<GmailAccountStatus> {
  const own = (await gmailAccountStatuses(userId, config, store, fetcher, now)).find(account => account.id === userId);
  if (!own) return anonymousGmailStatus;
  return { connected: own.connected, expired: own.expired, mailbox: own.mailbox };
}

/**
 * Status for every account of a validated session user. Never returns tokens. Rows saved before #109 have no sealed
 * mailbox: when the access token is still valid the address is fetched once from Gmail's profile and re-sealed with
 * the tokens (best effort, a failure just leaves `mailbox: null`).
 */
export async function gmailAccountStatuses(userId: string, config: ReturnType<typeof authConfig>, store: AuthStore,
  fetcher: Fetcher = fetch, now = Date.now()): Promise<LinkedAccountStatus[]> {
  const result: LinkedAccountStatus[] = [];
  for (const account of store.accounts(userId)) {
    result.push({ id: account.id, ...await accountStatus(userId, account, config, store, fetcher, now) });
  }
  return result;
}

async function accountStatus(userId: string, account: StoredAccount, config: ReturnType<typeof authConfig>,
  store: AuthStore, fetcher: Fetcher, now: number): Promise<GmailAccountStatus> {
  const status = localStatus(account, config.key, now);
  if (!status.connected || status.mailbox !== null || !account.tokenEnc) return status;
  let tokens;
  try { tokens = storedTokens.parse(unseal(account.tokenEnc, config.key, "tokens")); }
  catch { return status; }
  if (tokens.expiresAt <= now + 60000) return status;
  try {
    store.audit("gmail.fetch", userId, { endpoint: "users/me/profile", count: 1 });
    const fetched = await mailboxIdentity(tokens.accessToken, fetcher);
    // Don't overwrite tokens refreshed or cleared (disconnect, delete-all) while the profile request was in flight.
    if (store.findAccount(userId, account.id)?.tokenEnc === account.tokenEnc) {
      store.updateAccount(userId, account.id, seal({ ...tokens, mailbox: fetched }, config.key, "tokens"));
    }
    return { connected: true, expired: false, mailbox: fetched };
  } catch {
    return status;
  }
}