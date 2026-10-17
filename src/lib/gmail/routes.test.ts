import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET as preview } from "@/app/api/gmail/preview/route";
import { POST as sync } from "@/app/api/gmail/sync/route";
import { GET as status } from "@/app/api/gmail/sync/status/route";
import { GET as ledger } from "@/app/api/ledger/route";
import { GET as audit } from "@/app/api/audit/route";
import { POST as demo } from "@/app/api/demo/route";
import { POST as deleteAll } from "@/app/api/delete-all/route";
import { authConfig, SESSION_COOKIE } from "@/lib/auth/config";
import { createAuthStore, type AuthStore } from "@/lib/auth/store";
import { seal } from "@/lib/auth/crypto";
import { loadSeedDemo } from "@/lib/demo/seed";
import { appendAudit, getState, resetStore, withStoreScope } from "@/lib/store";
import type { GmailSyncResult } from "./service";
import * as service from "./service";
import { GmailError } from "./client";

let db: AuthStore;
vi.mock("@/lib/auth/store", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/auth/store")>();
  return { ...original, authStore: () => db };
});
function account(mailbox: string) {
  const key = authConfig().key;
  const id = db.save(mailbox, seal({ accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: Date.now() + 3600000 }, key, "tokens"));
  return { id, cookie: seal({ userId: id, expiresAt: Date.now() + 3600000 }, key, "session") };
}
function req(path: string, cookie?: string, body?: unknown) {
  return new Request(`http://localhost:3000/api/${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { origin: "http://localhost:3000", ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  db = createAuthStore(":memory:"); resetStore();
  vi.stubEnv("AUTH_ENCRYPTION_KEY", "ab".repeat(32)); vi.stubEnv("AUTH_BASE_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-secret");
});
afterEach(() => { db.close(); resetStore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("requires authentication and returns no bodies or credentials in preview", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ resultSizeEstimate: 430 })); vi.stubGlobal("fetch", fetcher);
  expect((await preview(req("gmail/preview"))).status).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
  const { cookie } = account("one@example.test");
  const response = await preview(req("gmail/preview", cookie));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ estimatedMessages: 430, messagesToFetch: 300, countIsEstimate: true });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("requires explicit sync confirmation and same-origin submission", async () => {
  const { cookie } = account("one@example.test");
  expect((await sync(req("gmail/sync", cookie, {}))).status).toBe(400);
  const cross = req("gmail/sync", cookie, { confirmed: true }); cross.headers.set("origin", "https://other.example.test");
  expect((await sync(cross)).status).toBe(403);
});
it("publishes into the connected account's ledger, isolated from other accounts and anonymous data", async () => {
  const first = account("first@example.test"), second = account("second@example.test");
  const seed = await loadSeedDemo({ cachePath: "missing-llm-cache.json" });
  vi.spyOn(service, "syncGmail").mockResolvedValue({ result: seed, fetched: 45, capped: false, parseErrors: [] });
  const response = await sync(req("gmail/sync", first.cookie, { confirmed: true }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ mode: "gmail", fetched: 45 });
  const firstLedger = await (await ledger(req("ledger", first.cookie))).json();
  expect(firstLedger.orders.length).toBeGreaterThan(0);
  expect(firstLedger.mode).toBe("gmail");
  expect((await (await ledger(req("ledger", second.cookie))).json()).orders).toEqual([]);
  expect((await (await ledger(req("ledger"))).json()).orders).toEqual([]);
  await demo(req("demo", second.cookie, {}));
  expect((await (await ledger(req("ledger", second.cookie))).json()).mode).toBe("demo");
  expect((await (await ledger(req("ledger", first.cookie))).json()).mode).toBe("gmail");
  // Same requests still have readable JSON bodies after the store wrapper.
  expect(service.syncGmail).toHaveBeenCalledTimes(1);
});
it("keeps audit and delete-all isolated and invalidates deleted sessions", async () => {
  const first = account("first@example.test"), second = account("second@example.test");
  withStoreScope(first.id, () => appendAudit({ at: new Date().toISOString(), type: "gmail_fetch", detail: "first-only" }));
  withStoreScope(second.id, () => appendAudit({ at: new Date().toISOString(), type: "gmail_fetch", detail: "second-only" }));
  expect(JSON.stringify(await (await audit(req("audit", second.cookie))).json())).not.toContain("first-only");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  expect((await deleteAll(req("delete-all", first.cookie, {}))).status).toBe(200);
  expect((await ledger(req("ledger", first.cookie))).status).toBe(401);
  expect(withStoreScope(first.id, getState).audit[0].type).toBe("delete");
  expect(withStoreScope(second.id, getState).audit[0].detail).toBe("second-only");
});
it("rejects overlapping syncs without unlocking the first running sync", async () => {
  const { cookie } = account("one@example.test");
  const seed = await loadSeedDemo({ cachePath: "missing-llm-cache.json" });
  let release!: (value: GmailSyncResult) => void;
  const deferred = new Promise<GmailSyncResult>(resolve => { release = resolve; });
  const spy = vi.spyOn(service, "syncGmail").mockReturnValue(deferred);
  const pending = sync(req("gmail/sync", cookie, { confirmed: true }));
  await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  expect(await (await status(req("gmail/sync/status", cookie))).json()).toMatchObject({ stage: "listing" });
  expect((await sync(req("gmail/sync", cookie, { confirmed: true }))).status).toBe(409);
  expect(await (await status(req("gmail/sync/status", cookie))).json()).toMatchObject({ stage: "listing" });
  expect((await sync(req("gmail/sync", cookie, { confirmed: true }))).status).toBe(409);
  release({ result: seed, fetched: 45, capped: false, parseErrors: [] });
  expect((await pending).status).toBe(200);
  expect(await (await status(req("gmail/sync/status", cookie))).json()).toMatchObject({ stage: "complete" });
});
it("does not publish results after deletion invalidates the session", async () => {
  const { id, cookie } = account("one@example.test");
  const seed = await loadSeedDemo({ cachePath: "missing-llm-cache.json" });
  vi.spyOn(service, "syncGmail").mockImplementation(async () => {
    db.remove(id);
    return { result: seed, fetched: 45, capped: false, parseErrors: [] };
  });
  expect((await sync(req("gmail/sync", cookie, { confirmed: true }))).status).toBe(401);
  expect(withStoreScope(id, getState).orders).toEqual([]);
  expect((await status(req("gmail/sync/status", cookie))).status).toBe(401);
});

it("polls actual progress locally and isolates other accounts, never returning message data", async () => {
  const first = account("first@example.test"), second = account("second@example.test");
  const seed = await loadSeedDemo({ cachePath: "missing-llm-cache.json" });
  const fetcher = vi.fn(() => { throw new Error("Unexpected network call"); });
  vi.stubGlobal("fetch", fetcher);
  let release!: (value: GmailSyncResult) => void;
  vi.spyOn(service, "syncGmail").mockImplementation(options => {
    options.onProgress?.({ stage: "fetching", fetched: 2, total: 5, skipped: 1 });
    return new Promise(resolve => { release = resolve; });
  });
  const pending = sync(req("gmail/sync", first.cookie, { confirmed: true }));
  await vi.waitFor(() => expect(release).toBeDefined());
  const response = await status(req("gmail/sync/status", first.cookie));
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ stage: "fetching", fetched: 2, total: 5, skipped: 1 });
  expect(await (await status(req("gmail/sync/status", second.cookie))).json()).toEqual({
    stage: "idle", fetched: 0, total: null, skipped: 0,
  });
  expect((await status(req("gmail/sync/status"))).status).toBe(401);
  expect((await status(req("gmail/sync/status", "invalid"))).status).toBe(401);
  release({ result: seed, fetched: 5, capped: false, parseErrors: [] });
  expect((await pending).status).toBe(200);
  expect(fetcher).not.toHaveBeenCalled();
});

it("reports failed syncs without exposing arbitrary error details and permits retry", async () => {
  const { cookie } = account("one@example.test");
  const spy = vi.spyOn(service, "syncGmail").mockRejectedValue(new GmailError(503, "gmail_unavailable"));
  expect((await sync(req("gmail/sync", cookie, { confirmed: true }))).status).toBe(503);
  expect(await (await status(req("gmail/sync/status", cookie))).json()).toEqual({
    stage: "failed", fetched: 0, total: null, skipped: 0,
  });
  const seed = await loadSeedDemo({ cachePath: "missing-llm-cache.json" });
  spy.mockResolvedValue({ result: seed, fetched: 0, capped: false, parseErrors: [] });
  expect((await sync(req("gmail/sync", cookie, { confirmed: true }))).status).toBe(200);
  expect(await (await status(req("gmail/sync/status", cookie))).json()).toMatchObject({ stage: "complete" });
});

it("marks aborted syncs failed without publishing a ledger", async () => {
  const { id, cookie } = account("one@example.test");
  const seed = await loadSeedDemo({ cachePath: "missing-llm-cache.json" });
  const abort = new AbortController();
  const request = new Request(req("gmail/sync", cookie, { confirmed: true }), { signal: abort.signal });
  vi.spyOn(service, "syncGmail").mockImplementation(async () => {
    abort.abort();
    return { result: seed, fetched: 45, capped: false, parseErrors: [] };
  });
  expect((await sync(request)).status).toBe(503);
  expect(await (await status(req("gmail/sync/status", cookie))).json()).toMatchObject({ stage: "failed" });
  expect(withStoreScope(id, getState).orders).toEqual([]);
});
