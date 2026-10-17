import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./config";
import { seal } from "./crypto";
import { getSession } from "./session";
import { authStore, createAuthStore, type AuthStore } from "./store";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("./store", async importOriginal => {
  const actual = await importOriginal<typeof import("./store")>();
  return { ...actual, authStore: vi.fn() };
});

const key = "ab".repeat(32);
const now = 1800000000000;
let db: AuthStore;
const tokens = (extra = {}) => seal({ accessToken: "synthetic-access", refreshToken: "synthetic-refresh",
  expiresAt: now + 3600000, ...extra }, key, "tokens");
const session = (userId: string, expiresAt = now + 60000) => seal({ userId, expiresAt }, key, "session");
const request = (cookie?: string) => new Request("http://localhost:3000/ledger", {
  headers: cookie ? { cookie: `unrelated=synthetic; ${SESSION_COOKIE}=${cookie}` } : {},
});

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-secret");
  vi.stubEnv("AUTH_ENCRYPTION_KEY", key);
  vi.stubEnv("AUTH_BASE_URL", "http://localhost:3000");
  db = createAuthStore(":memory:");
  vi.mocked(authStore).mockReturnValue(db);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network call"); }));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  db.close(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks();
});

describe("server session helper", () => {
  it("allows anonymous requests without requiring auth configuration or opening the DB", async () => {
    vi.stubEnv("AUTH_ENCRYPTION_KEY", "");
    expect(await getSession(request())).toBeNull();
    expect(authStore).not.toHaveBeenCalled();
  });
  it.each(["tampered", "", seal({ userId: "synthetic", expiresAt: now }, key, "session"),
    seal({ userId: "synthetic", expiresAt: now + 60000 }, key, "oauth")])(
    "rejects invalid, expired, or wrong-purpose cookies (%#)", async cookie => {
      expect(await getSession(request(cookie))).toBeNull();
      expect(authStore).not.toHaveBeenCalled();
    });
  it("returns only identity and connection status for the requested account", async () => {
    const id = db.save("one@example.test", tokens());
    db.save("two@example.test", tokens());
    expect(await getSession(request(session(id)))).toEqual({ userId: id, gmailConnected: true });
    expect(cookies).not.toHaveBeenCalled();
  });
  it("reads server component cookies when no request is passed", async () => {
    const id = db.save("one@example.test", tokens());
    const jar = new Map([[SESSION_COOKIE, { name: SESSION_COOKIE, value: session(id) }]]);
    vi.mocked(cookies).mockResolvedValue(jar as unknown as Awaited<ReturnType<typeof cookies>>);
    expect(await getSession()).toEqual({ userId: id, gmailConnected: true });
  });
  it("returns null for a deleted account even when its encrypted cookie has not expired", async () => {
    const id = db.save("one@example.test", tokens());
    const req = request(session(id));
    expect(await getSession(req)).not.toBeNull();
    db.remove(id);
    expect(await getSession(req)).toBeNull();
    expect(db.save("one@example.test", tokens())).not.toBe(id);
    expect(await getSession(req)).toBeNull();
  });
  it("keeps identity but reports disconnected after credentials are cleared", async () => {
    const id = db.save("one@example.test", tokens());
    db.update(id, null);
    expect(await getSession(request(session(id)))).toEqual({ userId: id, gmailConnected: false });
  });
  it.each(["invalid", tokens({ refreshExpiresAt: now }),
    seal({ accessToken: "synthetic" }, key, "tokens")])(
    "does not treat invalid or expired refresh credentials as connected (%#)", async tokenEnc => {
      const id = db.save("one@example.test", tokenEnc);
      expect(await getSession(request(session(id)))).toEqual({ userId: id, gmailConnected: false });
      expect(db.find(id)?.tokenEnc).toBe(tokenEnc);
    });
  it("accepts a refreshable expired access token without refreshing or writing", async () => {
    const tokenEnc = tokens({ expiresAt: now - 1, refreshExpiresAt: now + 60000 });
    const id = db.save("one@example.test", tokenEnc);
    expect(await getSession(request(session(id)))).toEqual({ userId: id, gmailConnected: true });
    expect(db.find(id)?.tokenEnc).toBe(tokenEnc);
  });
  it("propagates configuration and DB failures rather than falling back to anonymous", async () => {
    const req = request(session("synthetic"));
    vi.stubEnv("AUTH_ENCRYPTION_KEY", "invalid");
    await expect(getSession(req)).rejects.toThrow();
    vi.stubEnv("AUTH_ENCRYPTION_KEY", key);
    vi.mocked(authStore).mockImplementationOnce(() => { throw new Error("Database unavailable"); });
    await expect(getSession(req)).rejects.toThrow("Database unavailable");
  });
});
