import { z } from "zod";
import { authConfig, GMAIL_SCOPE, SESSION_SECONDS } from "./config";
import { challenge, equalSecrets, randomSecret, seal, unseal } from "./crypto";
import { AuthError, mailboxIdentity, requestTokens, storedTokens, type Fetcher } from "./google";
import type { AuthStore } from "./store";

const transactionSchema = z.object({ state: z.string(), verifier: z.string(), expiresAt: z.number() });
const sessionSchema = z.object({ userId: z.string(), expiresAt: z.number() });
type Config = ReturnType<typeof authConfig>;

export function beginAuthorization(config: Config, now = Date.now()) {
  const state = randomSecret(), verifier = randomSecret();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri,
    response_type: "code", scope: GMAIL_SCOPE, access_type: "offline", prompt: "consent",
    include_granted_scopes: "false", state, code_challenge: challenge(verifier), code_challenge_method: "S256" }).toString();
  return { url: url.toString(), cookie: seal({ state, verifier, expiresAt: now + 600000 }, config.key, "oauth") };
}

export async function finishAuthorization(params: URLSearchParams, cookie: string | undefined,
  config: Config, store: AuthStore, fetcher: Fetcher = fetch, now = Date.now()) {
  let txn;
  try { txn = transactionSchema.parse(unseal(cookie ?? "", config.key, "oauth")); }
  catch { throw new AuthError("invalid_state"); }
  if (txn.expiresAt <= now || !equalSecrets(txn.state, params.get("state") ?? "")) throw new AuthError("invalid_state");
  if (params.has("error")) {
    // access_denied also covers a user declining consent, not just missing test users.
    throw new AuthError(params.get("error") === "access_denied" ? "access_denied" : "oauth_failed");
  }
  const code = params.get("code");
  if (!code) throw new AuthError("oauth_failed");
  const token = await requestTokens(new URLSearchParams({ client_id: config.clientId,
    client_secret: config.clientSecret, code, code_verifier: txn.verifier,
    redirect_uri: config.redirectUri, grant_type: "authorization_code" }), fetcher);
  if (!token.refresh_token) throw new AuthError("token_expired");
  store.audit("gmail.fetch", null, { endpoint: "users/me/profile", count: 1 });
  const mailbox = await mailboxIdentity(token.access_token, fetcher);
  const value = { accessToken: token.access_token, refreshToken: token.refresh_token, mailbox,
    expiresAt: now + token.expires_in * 1000,
    refreshExpiresAt: token.refresh_token_expires_in ? now + token.refresh_token_expires_in * 1000 : undefined };
  const userId = store.save(mailbox, seal(value, config.key, "tokens"));
  store.audit("oauth.connected", userId);
  return seal({ userId, expiresAt: now + SESSION_SECONDS * 1000 }, config.key, "session");
}

export function sessionUser(cookie: string | undefined, config: Config, now = Date.now()) {
  try {
    const session = sessionSchema.parse(unseal(cookie ?? "", config.key, "session"));
    if (session.expiresAt > now) return session.userId;
  } catch { /* Invalid/expired cookies are unauthenticated. */ }
  return null;
}

// Server-only: never return an access token in a browser response.
export async function getAccessToken(userId: string, config: Config, store: AuthStore,
  fetcher: Fetcher = fetch, now = Date.now()): Promise<string> {
  const row = store.find(userId);
  if (!row?.tokenEnc) throw new AuthError("token_expired");
  let tokens;
  try { tokens = storedTokens.parse(unseal(row.tokenEnc, config.key, "tokens")); }
  catch { throw new AuthError("token_expired"); }
  if (tokens.refreshExpiresAt !== undefined && tokens.refreshExpiresAt <= now) {
    store.update(userId, null);
    throw new AuthError("token_expired");
  }
  if (tokens.expiresAt > now + 60000) return tokens.accessToken;
  try {
    const fresh = await requestTokens(new URLSearchParams({ client_id: config.clientId,
      client_secret: config.clientSecret, refresh_token: tokens.refreshToken, grant_type: "refresh_token" }), fetcher);
    const updated = { ...tokens, accessToken: fresh.access_token, expiresAt: now + fresh.expires_in * 1000,
      refreshToken: fresh.refresh_token ?? tokens.refreshToken,
      refreshExpiresAt: fresh.refresh_token_expires_in ? now + fresh.refresh_token_expires_in * 1000 : tokens.refreshExpiresAt };
    store.update(userId, seal(updated, config.key, "tokens"));
    store.audit("oauth.refreshed", userId);
    return updated.accessToken;
  } catch (error) {
    if (error instanceof AuthError && error.reason === "token_expired") {
      store.update(userId, null);
      store.audit("oauth.expired", userId);
    }
    throw error;
  }
}
