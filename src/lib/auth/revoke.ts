import type { authConfig } from "./config";
import { unseal } from "./crypto";
import { storedTokens, type Fetcher } from "./google";
import type { AuthStore } from "./store";

/** Delete locally first; Google outages must not leave usable local credentials.
 * Only the id from a validated session may be passed by the route. Removes the profile and every linked Gmail account
 * (#114); true only when each stored grant (at least one) was revoked at Google.
 */
export async function revokeUserAuthorization(
  userId: string,
  config: ReturnType<typeof authConfig>,
  store: AuthStore,
  fetcher: Fetcher = fetch,
): Promise<boolean> {
  if (!store.find(userId)) return false;
  const refreshTokens = store.accounts(userId).map(account => storedRefreshToken(account.tokenEnc, config.key));
  store.remove(userId);
  return revokeRefreshTokens(refreshTokens, fetcher);
}

/**
 * Disconnect Gmail only: clears the grant (and the sealed mailbox) but keeps the user row, session identity, linked
 * account rows and ledger. `accountId` limits it to one account (#114); by default every account is disconnected.
 * Returns true only when each cleared grant (at least one) was revoked at Google.
 */
export async function disconnectUserAuthorization(
  userId: string,
  config: ReturnType<typeof authConfig>,
  store: AuthStore,
  fetcher: Fetcher = fetch,
  accountId?: string,
): Promise<boolean> {
  if (!store.find(userId)) return false;
  const targets = store.accounts(userId).filter(account => accountId === undefined || account.id === accountId);
  const refreshTokens = targets.map(account => storedRefreshToken(account.tokenEnc, config.key));
  for (const account of targets) {
    store.updateAccount(userId, account.id, null);
    store.audit("oauth.disconnected", userId, account.id === userId ? {} : { accountId: account.id });
  }
  return revokeRefreshTokens(refreshTokens, fetcher);
}

async function revokeRefreshTokens(refreshTokens: Array<string | undefined>, fetcher: Fetcher): Promise<boolean> {
  const present = refreshTokens.filter((token): token is string => token !== undefined);
  const results = await Promise.all(present.map(token => revokeRefreshToken(token, fetcher)));
  return results.length > 0 && results.every(Boolean);
}

/** Undecryptable credentials yield undefined (they are cleared anyway); never log their value or error. */
function storedRefreshToken(tokenEnc: string | null, key: string): string | undefined {
  try {
    return tokenEnc ? storedTokens.parse(unseal(tokenEnc, key, "tokens")).refreshToken : undefined;
  } catch {
    return undefined;
  }
}

async function revokeRefreshToken(refreshToken: string | undefined, fetcher: Fetcher): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const response = await fetcher("https://oauth2.googleapis.com/revoke", {
      method: "POST", body: new URLSearchParams({ token: refreshToken }),
      cache: "no-store", signal: AbortSignal.timeout(15000), redirect: "error",
    });
    // Do not read or expose Google's response body. A failed or already-invalid
    // token is not reported as a successful revocation by this request.
    return response.ok;
  } catch {
    return false;
  }
}
