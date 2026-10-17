import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/delete-all/route";
import { GET as sessionStatus } from "@/app/api/auth/session/route";
import { authConfig, SESSION_COOKIE, TRANSACTION_COOKIE } from "./config";
import { seal } from "./crypto";
import { createAuthStore, type AuthStore } from "./store";
import { revokeUserAuthorization } from "./revoke";
import { getAccessToken } from "./service";
import { appendAudit, getState, resetStore, setRevokeOAuthHook } from "@/lib/store";

let db: AuthStore;
vi.mock("./store", async importOriginal => {
  const original = await importOriginal<typeof import("./store")>();
  return { ...original, authStore: () => db };
});
const key = "ab".repeat(32);
function addUser(mailbox = "shopper@example.test") {
  return db.save(mailbox, seal({ accessToken: "synthetic-access", refreshToken: "synthetic-refresh",
    expiresAt: Date.now() + 3600000 }, key, "tokens"));
}
function session(id: string) {
  return seal({ userId: id, expiresAt: Date.now() + 3600000 }, key, "session");
}
function request(cookie?: string, origin = "http://localhost:3000") {
  return new NextRequest("http://localhost:3000/api/delete-all", { method: "POST",
    headers: { origin, ...(cookie === undefined ? {} : { cookie: `${SESSION_COOKIE}=${cookie}` }) } });
}
beforeEach(() => {
  resetStore(); db = createAuthStore(":memory:");
  vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-secret");
  vi.stubEnv("AUTH_ENCRYPTION_KEY", key); vi.stubEnv("AUTH_BASE_URL", "http://localhost:3000");
  appendAudit({ at: new Date().toISOString(), type: "sync_start", detail: "Synthetic run" });
});
afterEach(() => { db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetStore(); });

describe("OAuth delete-all integration", () => {
  it("revokes the refresh token in a POST body and deletes the current identity", async () => {
    const id = addUser(), other = addUser("other@example.test");
    db.audit("oauth.connected", id);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      // Local identity is already gone, even while waiting for Google's response.
      expect(db.find(id)).toBeUndefined();
      expect(url).toBe("https://oauth2.googleapis.com/revoke");
      expect(init?.method).toBe("POST");
      expect((init?.body as URLSearchParams).get("token")).toBe("synthetic-refresh");
      expect(init?.redirect).toBe("error");
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(request(session(id)));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deleted: true, revokedToken: true });
    expect(db.find(other)).toBeDefined();
    expect(getState().audit).toHaveLength(1);
    const safeAudit = JSON.stringify(getState().audit);
    expect(safeAudit).not.toContain("synthetic-refresh");
    expect(safeAudit).not.toContain("synthetic-access");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const cookies = response.headers.get("set-cookie")!;
    expect(cookies).toContain(`${SESSION_COOKIE}=`);
    expect(cookies).toContain(`${TRANSACTION_COOKIE}=`);
    expect(cookies).toContain("Max-Age=0");
  });
  it.each([400, 503])("clears local identity and data when Google returns %s", async status => {
    const id = addUser();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("synthetic private error", { status })));
    const response = await POST(request(session(id)));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deleted: true, revokedToken: false });
    expect(db.find(id)).toBeUndefined();
    expect(getState().audit).toHaveLength(1);
    expect(JSON.stringify(getState())).not.toContain("synthetic private error");
  });
  it("still deletes locally when Google times out without logging its error", async () => {
    const id = addUser();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("synthetic-refresh should stay private")));
    const response = await POST(request(session(id)));
    expect(await response.json()).toMatchObject({ deleted: true, revokedToken: false });
    expect(db.find(id)).toBeUndefined();
    expect(JSON.stringify(getState().audit)).not.toContain("synthetic-refresh");
  });
  it("deletes undecryptable credentials without contacting Google", async () => {
    const id = db.save("shopper@example.test", "damaged-encrypted-value");
    const fetcher = vi.fn<typeof fetch>();
    expect(await revokeUserAuthorization(id, authConfig(), db, fetcher)).toBe(false);
    expect(db.find(id)).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("invalidates copied session cookies even after the same account reconnects", async () => {
    const id = addUser(), oldCookie = session(id);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await POST(request(oldCookie));
    const newId = addUser();
    expect(newId).not.toBe(id);
    await expect(getAccessToken(id, authConfig(), db)).rejects.toThrow("token_expired");
    const response = await sessionStatus(new NextRequest("http://localhost:3000/api/auth/session", {
      headers: { cookie: `${SESSION_COOKIE}=${oldCookie}` },
    }));
    expect(response.status).toBe(401);
    expect(await getAccessToken(newId, authConfig(), db)).toBe("synthetic-access");
  });
  it.each(["tampered", "expired", "deleted"])("rejects a %s session without deleting data or another account", async kind => {
    const id = addUser();
    const cookies = { tampered: "invalid", expired: seal({ userId: id, expiresAt: 1 }, key, "session"), deleted: session("absent-id") };
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const response = await POST(request(cookies[kind as keyof typeof cookies]));
    expect(response.status).toBe(401);
    expect(db.find(id)).toBeDefined();
    expect(getState().audit[0].type).toBe("sync_start");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("anonymous demo deletion cannot invoke a global account revoker", async () => {
    const id = addUser(), hook = vi.fn().mockResolvedValue(true);
    setRevokeOAuthHook(hook);
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ deleted: true, revokedToken: false });
    expect(hook).not.toHaveBeenCalled();
    expect(db.find(id)).toBeDefined();
  });
  it("rejects cross-origin and cross-site requests before touching storage", async () => {
    const id = addUser();
    expect((await POST(request(session(id), "https://untrusted.example.test"))).status).toBe(403);
    const crossSite = request(session(id)); crossSite.headers.set("sec-fetch-site", "cross-site");
    expect((await POST(crossSite)).status).toBe(403);
    expect(db.find(id)).toBeDefined();
    expect(getState().audit[0].type).toBe("sync_start");
  });
  it("does not accept account selection from the request body or query string", async () => {
    const current = addUser(), other = addUser("other@example.test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const response = await POST(new NextRequest(`http://localhost:3000/api/delete-all?userId=${other}`, {
      method: "POST", headers: { origin: "http://localhost:3000", cookie: `${SESSION_COOKIE}=${session(current)}` },
      body: JSON.stringify({ userId: other }),
    }));
    expect(response.status).toBe(200);
    expect(db.find(current)).toBeUndefined();
    expect(db.find(other)).toBeDefined();
  });
  it("refuses connected deletion if encryption configuration is missing", async () => {
    const id = addUser(), cookie = session(id);
    vi.stubEnv("AUTH_ENCRYPTION_KEY", "");
    expect((await POST(request(cookie))).status).toBe(503);
    expect(db.find(id)).toBeDefined();
    expect(getState().audit[0].type).toBe("sync_start");
  });
  it("keeps anonymous demo deletion available without Google configuration", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", ""); vi.stubEnv("AUTH_ENCRYPTION_KEY", "");
    expect((await POST(request())).status).toBe(200);
    expect(getState().audit[0].type).toBe("delete");
  });
  it("passes independent account revokers without changing the global hook", async () => {
    const first = addUser(), second = addUser("other@example.test");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    const { deleteAll } = await import("@/lib/store");
    await Promise.all([deleteAll(undefined, () => revokeUserAuthorization(first, authConfig(), db, fetcher)),
      deleteAll(undefined, () => revokeUserAuthorization(second, authConfig(), db, fetcher))]);
    expect(db.find(first)).toBeUndefined(); expect(db.find(second)).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
