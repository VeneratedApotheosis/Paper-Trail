import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/config";
import { seal } from "@/lib/auth/crypto";
import { createAuthStore, type AuthStore } from "@/lib/auth/store";
import { withStoreScope, resetStore, getState, appendAudit } from "@/lib/store";
import { withAccountStore } from "./context";

let db: AuthStore;
vi.mock("@/lib/auth/store", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/auth/store")>(), authStore: () => db,
}));
const key = "ab".repeat(32);
const cookie = (id: string, expiresAt = Date.now() + 60000) => seal({ userId: id, expiresAt }, key, "session");
const request = (value: string) => new Request("http://localhost:3000/api/example", {
  headers: { cookie: `${SESSION_COOKIE}=${value}` },
});
beforeEach(() => {
  db = createAuthStore(":memory:"); resetStore();
  vi.stubEnv("AUTH_ENCRYPTION_KEY", key); vi.stubEnv("AUTH_BASE_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-secret");
});
afterEach(() => { db.close(); resetStore(); vi.unstubAllEnvs(); });

it("lets a cleared-grant identity into only its own scope, except where a live Gmail grant is required", async () => {
  const id = db.save("synthetic@example.test", "synthetic-encrypted");
  db.update(id, null);
  withStoreScope(id, () => { resetStore(); appendAudit({ at: new Date().toISOString(), type: "sync_start", detail: "account-only" }); });
  appendAudit({ at: new Date().toISOString(), type: "sync_start", detail: "anonymous-only" });
  const handler = vi.fn(async (request: Request) => Response.json({ entries: getState().audit, path: new URL(request.url).pathname }));
  const normal = await withAccountStore(handler, { requireToken: true })(request(cookie(id)));
  expect(normal.status).toBe(401);
  // Clearing this valid identity here would make the owner's data undeletable.
  expect(normal.headers.get("set-cookie")).toBeNull();
  expect(handler).not.toHaveBeenCalled();
  for (const options of [undefined, { requireToken: false }]) {
    const accountScope = await withAccountStore(handler, options)(request(cookie(id)));
    const text = await accountScope.text();
    expect(text).toContain("account-only");
    expect(text).not.toContain("anonymous-only");
    expect(accountScope.headers.get("cache-control")).toBe("no-store");
  }
});
it.each(["invalid", "expired", "deleted"])("clears %s identity cookies without invoking an anonymous handler", async kind => {
  const id = db.save("synthetic@example.test", "synthetic-encrypted");
  if (kind === "deleted") db.remove(id);
  const value = kind === "invalid" ? "tampered" : cookie(id, kind === "expired" ? Date.now() - 1 : Date.now() + 60000);
  const handler = vi.fn(async (request: Request) => Response.json({ dangerous: true, path: new URL(request.url).pathname }));
  for (const requireToken of [false, true]) {
    const result = await withAccountStore(handler, { requireToken })(request(value));
    expect(result.status).toBe(401);
    expect(result.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
    expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(result.headers.get("cache-control")).toBe("no-store");
  }
  expect(handler).not.toHaveBeenCalled();
});
