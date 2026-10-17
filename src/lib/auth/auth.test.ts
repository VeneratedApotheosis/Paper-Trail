import { afterEach, describe, expect, it, vi } from "vitest";
import { authConfig, GMAIL_SCOPE } from "./config";
import { challenge, seal, unseal } from "./crypto";
import { beginAuthorization, finishAuthorization, getAccessToken, sessionUser } from "./service";
import { createAuthStore, type AuthStore } from "./store";
import { requestTokens } from "./google";

const config = { clientId: "synthetic-client", clientSecret: "synthetic-secret", key: "ab".repeat(32),
  origin: "http://localhost:3000", redirectUri: "http://localhost:3000/api/auth/callback", secure: false };
const now = 1800000000000;
const stores: AuthStore[] = [];
function store() { const value = createAuthStore(":memory:"); stores.push(value); return value; }
function callback(flow: ReturnType<typeof beginAuthorization>) {
  return new URLSearchParams({ code: "synthetic-code", state: new URL(flow.url).searchParams.get("state")! });
}
function google() {
  return vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ access_token: "synthetic-access", refresh_token: "synthetic-refresh",
      expires_in: 3600, token_type: "Bearer", scope: GMAIL_SCOPE }))
    .mockResolvedValueOnce(Response.json({ emailAddress: "shopper@example.test" }));
}
afterEach(() => { stores.splice(0).forEach(s => s.close()); vi.unstubAllEnvs(); });

describe("OAuth boundary", () => {
  it("requests only readonly Gmail with offline consent and S256 PKCE", () => {
    const flow = beginAuthorization(config, now);
    const params = new URL(flow.url).searchParams;
    const txn = unseal(flow.cookie, config.key, "oauth") as { verifier: string };
    expect(params.get("scope")).toBe(GMAIL_SCOPE);
    expect(params.get("include_granted_scopes")).toBe("false");
    expect(params.get("code_challenge")).toBe(challenge(txn.verifier));
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("access_type")).toBe("offline");
    expect(params.get("prompt")).toBe("consent");
    expect(params.get("redirect_uri")).toBe(config.redirectUri);
  });
  it("authenticates encrypted payloads and separates cookie/token purposes", () => {
    const encoded = seal({ value: "synthetic" }, config.key, "tokens");
    expect(unseal(encoded, config.key, "tokens")).toEqual({ value: "synthetic" });
    expect(() => unseal(encoded, config.key, "session")).toThrow();
    expect(() => unseal(encoded, "cd".repeat(32), "tokens")).toThrow();
    const bytes = Buffer.from(encoded, "base64url"); bytes[15] ^= 1;
    expect(() => unseal(bytes.toString("base64url"), config.key, "tokens")).toThrow();
  });
  it("rejects missing, mismatched, expired, and tampered state before network access", async () => {
    const flow = beginAuthorization(config, now), db = store(), fetcher = google();
    const params = callback(flow);
    await expect(finishAuthorization(params, undefined, config, db, fetcher, now)).rejects.toThrow("invalid_state");
    await expect(finishAuthorization(new URLSearchParams({ state: "wrong", code: "x" }), flow.cookie, config, db, fetcher, now)).rejects.toThrow("invalid_state");
    await expect(finishAuthorization(params, flow.cookie, config, db, fetcher, now + 600000)).rejects.toThrow("invalid_state");
    await expect(finishAuthorization(params, "invalid", config, db, fetcher, now)).rejects.toThrow("invalid_state");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("handles denial without exchanging a code", async () => {
    const flow = beginAuthorization(config, now), params = callback(flow), fetcher = google();
    params.set("error", "access_denied");
    await expect(finishAuthorization(params, flow.cookie, config, store(), fetcher, now)).rejects.toThrow("access_denied");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("exchanges PKCE code, stores encrypted tokens, and creates an expiring session", async () => {
    const flow = beginAuthorization(config, now), db = store(), fetcher = google();
    const cookie = await finishAuthorization(callback(flow), flow.cookie, config, db, fetcher, now);
    const userId = sessionUser(cookie, config, now)!;
    const row = db.find(userId)!;
    expect(row.tokenEnc).not.toContain("synthetic-access");
    expect(row.tokenEnc).not.toContain("synthetic-refresh");
    expect(row.googleSub).toMatch(/^gmail:[a-f0-9]{64}$/);
    expect(sessionUser(cookie, config, now + 7 * 86400000)).toBeNull();
    expect(sessionUser("tampered", config, now)).toBeNull();
    const request = fetcher.mock.calls[0][1]?.body as URLSearchParams;
    const txn = unseal(flow.cookie, config.key, "oauth") as { verifier: string };
    expect(request.get("code_verifier")).toBe(txn.verifier);
    expect(await getAccessToken(userId, config, db, fetcher, now)).toBe("synthetic-access");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const second = beginAuthorization(config, now);
    const again = await finishAuthorization(callback(second), second.cookie, config, db, google(), now);
    expect(sessionUser(again, config, now)).toBe(userId);
  });
  it("requires offline refresh credentials and rejects expanded scopes", async () => {
    const flow = beginAuthorization(config, now);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      access_token: "synthetic", expires_in: 3600, token_type: "Bearer" }));
    await expect(finishAuthorization(callback(flow), flow.cookie, config, store(), fetcher, now)).rejects.toThrow("token_expired");
    fetcher.mockResolvedValue(Response.json({ access_token: "synthetic", expires_in: 3600,
      token_type: "Bearer", scope: `${GMAIL_SCOPE} https://www.googleapis.com/auth/gmail.modify` }));
    await expect(requestTokens(new URLSearchParams(), fetcher)).rejects.toThrow("oauth_failed");
  });
  it("refreshes expired tokens while preserving a refresh token omitted by Google", async () => {
    const db = store();
    const id = db.save("shopper@example.test", seal({ accessToken: "old", refreshToken: "synthetic-refresh", expiresAt: now }, config.key, "tokens"));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ access_token: "new", expires_in: 3600, token_type: "Bearer" }));
    expect(await getAccessToken(id, config, db, fetcher, now)).toBe("new");
    expect(unseal(db.find(id)!.tokenEnc!, config.key, "tokens")).toMatchObject({ refreshToken: "synthetic-refresh", accessToken: "new" });
    expect((fetcher.mock.calls[0][1]?.body as URLSearchParams).get("grant_type")).toBe("refresh_token");
  });
  it("invalidates revoked grants but preserves credentials on transient errors", async () => {
    const db = store();
    const encrypted = seal({ accessToken: "old", refreshToken: "synthetic-refresh", expiresAt: now }, config.key, "tokens");
    const id = db.save("shopper@example.test", encrypted);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: "temporarily_unavailable" }, { status: 503 }));
    await expect(getAccessToken(id, config, db, fetcher, now)).rejects.toThrow("oauth_failed");
    expect(db.find(id)!.tokenEnc).toBe(encrypted);
    fetcher.mockResolvedValue(Response.json({ error: "invalid_grant" }, { status: 400 }));
    await expect(getAccessToken(id, config, db, fetcher, now)).rejects.toThrow("token_expired");
    expect(db.find(id)!.tokenEnc).toBeNull();
  });
  it("rejects known expired refresh grants without contacting Google", async () => {
    const db = store();
    const id = db.save("shopper@example.test", seal({ accessToken: "old", refreshToken: "synthetic-refresh", expiresAt: now, refreshExpiresAt: now }, config.key, "tokens"));
    const fetcher = google();
    await expect(getAccessToken(id, config, db, fetcher, now)).rejects.toThrow("token_expired");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requires a real encryption key and rejects unsafe configured origins", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-secret");
    vi.stubEnv("AUTH_ENCRYPTION_KEY", config.key); vi.stubEnv("AUTH_BASE_URL", "https://example.test");
    expect(authConfig().secure).toBe(true);
    vi.stubEnv("AUTH_BASE_URL", "http://example.test"); expect(() => authConfig()).toThrow();
    vi.stubEnv("AUTH_BASE_URL", "http://localhost:3000/path"); expect(() => authConfig()).toThrow();
    vi.stubEnv("AUTH_ENCRYPTION_KEY", "placeholder"); expect(() => authConfig()).toThrow();
  });
});
