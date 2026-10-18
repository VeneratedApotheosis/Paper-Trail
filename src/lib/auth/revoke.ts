import type { authConfig } from "./config";
import { unseal } from "./crypto";
import { storedTokens, type Fetcher } from "./google";
import type { AuthStore } from "./store";

/** Delete locally first; Google outages must not leave usable local credentials.
 * Only the id from a validated session may be passed by the route.
 */
export async function revokeUserAuthorization(
  userId: string,
  config: ReturnType<typeof authConfig>,
  store: AuthStore,
  fetcher: Fetcher = fetch,
): Promise<boolean> {
  const row = store.find(userId);
  if (!row) return false;
  const refreshToken = storedRefreshToken(row.tokenEnc, config.key);
  store.remove(userId);
  return revokeRefreshToken(refreshToken, fetcher);
}

/** Disconnect Gmail only: clears the grant (and the sealed mailbox) but keeps the user row, session identity and ledger. */
export async function disconnectUserAuthorization(
  userId: string,
  config: ReturnType<typeof authConfig>,
  store: AuthStore,
  fetcher: Fetcher = fetch,
): Promise<boolean> {
  const row = store.find(userId);
  if (!row) return false;
  const refreshToken = storedRefreshToken(row.tokenEnc, config.key);
  store.update(userId, null);
  store.audit("oauth.disconnected", userId);
  return revokeRefreshToken(refreshToken, fetcher);
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
