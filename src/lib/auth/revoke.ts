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
  let refreshToken: string | undefined;
  try {
    if (row.tokenEnc) refreshToken = storedTokens.parse(unseal(row.tokenEnc, config.key, "tokens")).refreshToken;
  } catch {
    // Undecryptable credentials are deleted too; never log their value or error.
  }
  store.remove(userId);
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
