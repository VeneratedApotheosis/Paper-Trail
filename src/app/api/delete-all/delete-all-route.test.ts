// #84 owner integration: delete-all must work for a valid identity whose Gmail grant expired or was revoked,
// and must clear stale identity cookies when rejecting. Harness mirrors src/lib/auth/revoke.test.ts (Chelsea's).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { SESSION_COOKIE } from "@/lib/auth/config";
import { seal } from "@/lib/auth/crypto";
import { createAuthStore, type AuthStore } from "@/lib/auth/store";
import { appendAudit, getState, resetStore } from "@/lib/store";

let db: AuthStore;
vi.mock("@/lib/auth/store", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/auth/store")>();
  return { ...original, authStore: () => db };
});

const key = "ab".repeat(32);
function addUser(mailbox = "shopper@example.test") {
  return db.save(
    mailbox,
    seal({ accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: Date.now() + 3600000 }, key, "tokens"),
  );
}
function session(id: string) {
  return seal({ userId: id, expiresAt: Date.now() + 3600000 }, key, "session");
}
function request(cookie?: string) {
  return new NextRequest("http://localhost:3000/api/delete-all", {
    method: "POST",
    headers: { origin: "http://localhost:3000", ...(cookie === undefined ? {} : { cookie: `${SESSION_COOKIE}=${cookie}` }) },
  });
}

beforeEach(() => {
  resetStore();
  db = createAuthStore(":memory:");
  vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-secret");
  vi.stubEnv("AUTH_ENCRYPTION_KEY", key);
  vi.stubEnv("AUTH_BASE_URL", "http://localhost:3000");
  appendAudit({ at: new Date().toISOString(), type: "sync_start", detail: "Synthetic run" });
});
afterEach(() => {
  db.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetStore();
});

describe("delete-all with an expired Gmail grant (#84)", () => {
  it("deletes a valid identity whose token was cleared, without contacting Google", async () => {
    const id = addUser();
    const other = addUser("other@example.test");
    db.update(id, null); // what getAccessToken does when refresh fails / the grant is revoked
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);

    const response = await POST(request(session(id)));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deleted: true, revokedToken: false });
    expect(db.find(id)).toBeUndefined();
    expect(db.find(other)).toBeDefined();
    expect(fetcher).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    // The account's own scope was purged; the anonymous store (read here, outside any scope) is untouched.
    expect(getState().audit[0].type).toBe("sync_start");
  });

  it("rejects an invalid identity with 401 and clears its stale cookie", async () => {
    const id = addUser();
    const response = await POST(request("invalid"));

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie") ?? "").toContain(`${SESSION_COOKIE}=`);
    expect(db.find(id)).toBeDefined();
    expect(getState().audit[0].type).toBe("sync_start");
  });
});
