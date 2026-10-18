import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as account } from "@/app/api/account/route";
import { POST as disconnect } from "@/app/api/auth/disconnect/route";
import { GET as callback } from "@/app/api/auth/callback/route";
import { GET as sessionStatus } from "@/app/api/auth/session/route";
import { GET as preview } from "@/app/api/gmail/preview/route";
import { POST as sync } from "@/app/api/gmail/sync/route";
import { GET as ledger } from "@/app/api/ledger/route";
import { POST as deleteAll } from "@/app/api/delete-all/route";
import * as service from "@/lib/gmail/service";
import type { GmailSyncResult } from "@/lib/gmail/service";
import { loadSeedDemo } from "@/lib/demo/seed";
import { getState, resetStore, withStoreScope } from "@/lib/store";
import { GMAIL_SCOPE, SESSION_COOKIE, TRANSACTION_COOKIE, authConfig } from "./config";
import { seal, unseal } from "./crypto";
import { storedTokens } from "./google";
import { beginAuthorization } from "./service";
import { createAuthStore, type AuthStore } from "./store";

let db: AuthStore;
vi.mock("./store", async importOriginal => {
  const original = await importOriginal<typeof import("./store")>();
  return { ...original, authStore: () => db };
});
const key = "ab".repeat(32);
type TokenOptions = { mailbox?: string; expiresAt?: number; refreshExpiresAt?: number };
function addUser(address = "shopper@example.test", tokens: TokenOptions = {}) {
  const id = db.save(address, seal({ accessToken: "synthetic-access", refreshToken: "synthetic-refresh",
    expiresAt: Date.now() + 3600000, ...tokens }, key, "tokens"));
  return { id, cookie: seal({ userId: id, expiresAt: Date.now() + 3600000 }, key, "session") };
}
function req(path: string, cookie?: string, method = "GET", body?: unknown) {
  return new NextRequest(`http://localhost:3000/api/${path}`, { method,
    headers: { origin: "http://localhost:3000", ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const sealedMailbox = (id: string) => storedTokens.parse(unseal(db.find(id)!.tokenEnc!, key, "tokens")).mailbox;

beforeEach(() => {
  resetStore(); db = createAuthStore(":memory:");
  vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-secret");
  vi.stubEnv("AUTH_ENCRYPTION_KEY", key); vi.stubEnv("AUTH_BASE_URL", "http://localhost:3000");
});
afterEach(() => { db.close(); resetStore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("GET /api/account", () => {
  it("serves anonymous users without Gmail details", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const response = await account(req("account"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      gmail: { connected: false, expired: false, mailbox: null }, accounts: [], mode: "empty", asOf: null, lastSyncAt: null,
      counts: { orders: 0, findings: 0, reviewItems: 0 }, excludedMerchants: [], syncing: false, redaction: "off",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("shows the sealed mailbox for a connected account and never returns tokens", async () => {
    const { cookie } = addUser("shopper@example.test", { mailbox: "shopper@example.test" });
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const response = await account(req("account", cookie));
    const text = await response.text();
    expect(JSON.parse(text).gmail).toEqual({ connected: true, expired: false, mailbox: "shopper@example.test" });
    expect(text).not.toMatch(/synthetic-(access|refresh)/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("backfills the mailbox once for rows saved without it, re-sealing it with the tokens", async () => {
    const { id, cookie } = addUser();
    expect(sealedMailbox(id)).toBeUndefined();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ emailAddress: "Shopper@Example.test" }));
    vi.stubGlobal("fetch", fetcher);
    expect((await (await account(req("account", cookie))).json()).gmail.mailbox).toBe("shopper@example.test");
    expect(sealedMailbox(id)).toBe("shopper@example.test");
    expect(db.find(id)!.tokenEnc).not.toContain("shopper@example.test");
    expect((await (await account(req("account", cookie))).json()).gmail.mailbox).toBe("shopper@example.test");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports mailbox null when the backfill fetch fails but stays connected", async () => {
    const { cookie } = addUser();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect((await (await account(req("account", cookie))).json()).gmail).toEqual({ connected: true, expired: false, mailbox: null });
  });

  it("reports an expired grant for a signed-in identity, keeping a known mailbox", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const known = addUser("known@example.test", { mailbox: "known@example.test", refreshExpiresAt: Date.now() - 1000 });
    expect((await (await account(req("account", known.cookie))).json()).gmail)
      .toEqual({ connected: false, expired: true, mailbox: "known@example.test" });
    const cleared = addUser("cleared@example.test", { mailbox: "cleared@example.test" });
    db.update(cleared.id, null); // e.g. invalid_grant on refresh
    expect((await (await account(req("account", cleared.cookie))).json()).gmail)
      .toEqual({ connected: false, expired: true, mailbox: null });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects an invalid session cookie like the other account routes", async () => {
    expect((await account(req("account", "invalid"))).status).toBe(401);
  });

  it("reports lastSyncAt after a Gmail sync, counts, and syncing while one runs; delete-all clears them", async () => {
    const { id, cookie } = addUser("shopper@example.test", { mailbox: "shopper@example.test" });
    const seed = await loadSeedDemo({ cachePath: "missing-llm-cache.json" });
    let release!: (value: GmailSyncResult) => void;
    vi.spyOn(service, "syncGmail").mockImplementation(options => {
      options.onProgress?.({ stage: "fetching", fetched: 1, total: 3, skipped: 0 });
      return new Promise(resolve => { release = resolve; });
    });
    const before = Date.now();
    const pending = sync(req("gmail/sync", cookie, "POST", { confirmed: true }));
    await vi.waitFor(() => expect(release).toBeDefined());
    expect((await (await account(req("account", cookie))).json()).syncing).toBe(true);
    release({ result: seed, fetched: 45, capped: false, parseErrors: [] });
    expect((await pending).status).toBe(200);
    const body = await (await account(req("account", cookie))).json();
    expect(body).toMatchObject({ mode: "gmail", syncing: false });
    expect(Date.parse(body.lastSyncAt)).toBeGreaterThanOrEqual(before);
    expect(body.counts.orders).toBeGreaterThan(0);
    expect(body.counts).toEqual({ orders: seed.orders.length, findings: seed.findings.length, reviewItems: seed.reviewQueue.length });
    expect(withStoreScope(id, getState).lastSyncAt).toBe(body.lastSyncAt);
    // Another account and the anonymous store are unaffected.
    expect((await (await account(req("account"))).json()).lastSyncAt).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    expect((await deleteAll(req("delete-all", cookie, "POST", {}))).status).toBe(200);
    expect(withStoreScope(id, getState).lastSyncAt).toBeNull();
  });

  it("does not set lastSyncAt when a sync fails", async () => {
    const { id, cookie } = addUser();
    vi.spyOn(service, "syncGmail").mockRejectedValue(new Error("boom"));
    expect((await sync(req("gmail/sync", cookie, "POST", { confirmed: true }))).status).toBe(503);
    expect(withStoreScope(id, getState).lastSyncAt).toBeNull();
  });
});

describe("POST /api/auth/disconnect", () => {
  async function syncedAccount() {
    const user = addUser("shopper@example.test", { mailbox: "shopper@example.test" });
    const seed = await loadSeedDemo({ cachePath: "missing-llm-cache.json" });
    vi.spyOn(service, "syncGmail").mockResolvedValue({ result: seed, fetched: 45, capped: false, parseErrors: [] });
    expect((await sync(req("gmail/sync", user.cookie, "POST", { confirmed: true }))).status).toBe(200);
    return { ...user, orders: seed.orders.length };
  }

  it("revokes the grant, clears tokens and mailbox, keeps identity and ledger, and blocks Gmail routes", async () => {
    const { id, cookie, orders } = await syncedAccount();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      expect(url).toBe("https://oauth2.googleapis.com/revoke");
      expect((init?.body as URLSearchParams).get("token")).toBe("synthetic-refresh");
      expect(db.find(id)?.tokenEnc).toBeNull(); // cleared locally before Google answers
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetcher);
    const response = await disconnect(req("auth/disconnect", cookie, "POST"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ disconnected: true, revokedToken: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(db.find(id)).toMatchObject({ id, tokenEnc: null });
    expect(withStoreScope(id, getState).audit[0]).toMatchObject({ type: "approval", detail: expect.stringContaining("Gmail disconnected") });

    const status = await (await account(req("account", cookie))).json();
    expect(status.gmail).toEqual({ connected: false, expired: true, mailbox: null });
    expect(status.counts.orders).toBe(orders);
    expect(status.mode).toBe("gmail");
    expect(status.lastSyncAt).not.toBeNull();
    expect((await (await ledger(req("ledger", cookie))).json()).orders).toHaveLength(orders);
    expect((await sessionStatus(req("auth/session", cookie))).status).toBe(401);
    // Gmail routes ask the UI to reconnect, without calling Google.
    fetcher.mockClear();
    const blockedPreview = await preview(req("gmail/preview", cookie));
    expect(blockedPreview.status).toBe(401);
    expect(await blockedPreview.json()).toMatchObject({ reconnectUrl: "/api/auth/google" });
    expect((await sync(req("gmail/sync", cookie, "POST", { confirmed: true }))).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("clears credentials even when Google is unreachable", async () => {
    const { id, cookie } = addUser();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await (await disconnect(req("auth/disconnect", cookie, "POST"))).json()).toEqual({ disconnected: true, revokedToken: false });
    expect(db.find(id)?.tokenEnc).toBeNull();
  });

  it("is idempotent and needs a signed-in identity and a same-origin request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    expect((await disconnect(req("auth/disconnect", undefined, "POST"))).status).toBe(401);
    expect((await disconnect(req("auth/disconnect", "invalid", "POST"))).status).toBe(401);
    const { cookie } = addUser();
    const cross = req("auth/disconnect", cookie, "POST"); cross.headers.set("origin", "https://other.example.test");
    expect((await disconnect(cross)).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await disconnect(req("auth/disconnect", cookie, "POST"))).status).toBe(200);
    expect(await (await disconnect(req("auth/disconnect", cookie, "POST"))).json()).toEqual({ disconnected: true, revokedToken: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reconnecting reuses the same account and its ledger; delete-all afterwards still works", async () => {
    const { id, cookie, orders } = await syncedAccount();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await disconnect(req("auth/disconnect", cookie, "POST"));

    const flow = beginAuthorization(authConfig());
    const state = new URL(flow.url).searchParams.get("state");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "synthetic-access-2", refresh_token: "synthetic-refresh-2",
        expires_in: 3600, token_type: "Bearer", scope: GMAIL_SCOPE }))
      .mockResolvedValueOnce(Response.json({ emailAddress: "shopper@example.test" })));
    const reconnected = await callback(new NextRequest(`http://localhost:3000/api/auth/callback?code=synthetic&state=${state}`, {
      headers: { cookie: `${TRANSACTION_COOKIE}=${flow.cookie}` } }));
    expect(reconnected.headers.get("location")).toBe("http://localhost:3000/sync");
    expect(sealedMailbox(id)).toBe("shopper@example.test");
    const newCookie = reconnected.cookies.get(SESSION_COOKIE)!.value;
    const status = await (await account(req("account", newCookie))).json();
    expect(status.gmail).toEqual({ connected: true, expired: false, mailbox: "shopper@example.test" });
    expect(status.counts.orders).toBe(orders);

    await disconnect(req("auth/disconnect", newCookie, "POST")); // disconnect, then delete everything
    const deleted = await deleteAll(req("delete-all", cookie, "POST", {}));
    expect(deleted.status).toBe(200);
    expect(db.find(id)).toBeUndefined();
  });

  it("delete-all removes the sealed mailbox together with the account", async () => {
    const { id, cookie } = addUser("shopper@example.test", { mailbox: "shopper@example.test" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    expect((await deleteAll(req("delete-all", cookie, "POST", {}))).status).toBe(200);
    expect(db.find(id)).toBeUndefined();
  });
});

describe("OAuth callback stores the mailbox sealed with the tokens", () => {
  it("seals the address inside the token blob, not in plain columns", async () => {
    const flow = beginAuthorization(authConfig());
    const state = new URL(flow.url).searchParams.get("state");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "synthetic-access", refresh_token: "synthetic-refresh",
        expires_in: 3600, token_type: "Bearer", scope: GMAIL_SCOPE }))
      .mockResolvedValueOnce(Response.json({ emailAddress: "Shopper@example.test" })));
    const response = await callback(new NextRequest(`http://localhost:3000/api/auth/callback?code=synthetic&state=${state}`, {
      headers: { cookie: `${TRANSACTION_COOKIE}=${flow.cookie}` } }));
    const session = unseal(response.cookies.get(SESSION_COOKIE)!.value, key, "session") as { userId: string };
    const row = db.find(session.userId)!;
    expect(sealedMailbox(session.userId)).toBe("shopper@example.test");
    expect(JSON.stringify(row)).not.toContain("shopper@example.test");
  });
});
