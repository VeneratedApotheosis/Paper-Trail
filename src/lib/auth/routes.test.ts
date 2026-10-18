import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as start } from "@/app/api/auth/google/route";
import { GET as callback } from "@/app/api/auth/callback/route";
import { GET as status } from "@/app/api/auth/session/route";
import { authConfig, GMAIL_SCOPE, SESSION_COOKIE, TRANSACTION_COOKIE } from "./config";
import { beginAuthorization } from "./service";
import { createAuthStore, type AuthStore } from "./store";

let db: AuthStore;
vi.mock("./store", async importOriginal => {
  const original = await importOriginal<typeof import("./store")>();
  return { ...original, authStore: () => db };
});
beforeEach(() => {
  db = createAuthStore(":memory:");
  vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-secret");
  vi.stubEnv("AUTH_ENCRYPTION_KEY", "ab".repeat(32));
  vi.stubEnv("AUTH_BASE_URL", "http://localhost:3000");
});
afterEach(() => { db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("sets a short-lived HttpOnly PKCE cookie and redirects only to Google", async () => {
  const response = await start();
  expect(response.status).toBe(307);
  expect(new URL(response.headers.get("location")!).hostname).toBe("accounts.google.com");
  const cookie = response.cookies.get(TRANSACTION_COOKIE)!;
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe("lax");
  expect(cookie.path).toBe("/api/auth");
  expect(cookie.maxAge).toBe(600);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("uses Secure cookies on HTTPS and returns a safe error when unconfigured", async () => {
  vi.stubEnv("AUTH_BASE_URL", "https://papertrail.example.test");
  expect((await start()).cookies.get(TRANSACTION_COOKIE)?.secure).toBe(true);
  vi.stubEnv("AUTH_ENCRYPTION_KEY", "");
  const response = await start();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("synthetic-secret");
});
it("clears invalid transaction cookies without contacting Google", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const response = await callback(new NextRequest("http://localhost:3000/api/auth/callback?code=synthetic"));
  expect(response.headers.get("location")).toBe("http://localhost:3000/welcome?error=invalid_state");
  expect(response.cookies.get(TRANSACTION_COOKIE)?.maxAge).toBe(0);
  expect(fetcher).not.toHaveBeenCalled();
});
it("redirects denied users to the existing consent error state", async () => {
  const flow = beginAuthorization(authConfig());
  const state = new URL(flow.url).searchParams.get("state");
  const response = await callback(new NextRequest(`http://localhost:3000/api/auth/callback?error=access_denied&state=${state}`, {
    headers: { cookie: `${TRANSACTION_COOKIE}=${flow.cookie}` },
  }));
  expect(response.headers.get("location")).toBe("http://localhost:3000/welcome?error=access_denied");
});
it("establishes a session and exposes only connection status, never tokens", async () => {
  const flow = beginAuthorization(authConfig());
  const state = new URL(flow.url).searchParams.get("state");
  vi.stubGlobal("fetch", vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600, token_type: "Bearer", scope: GMAIL_SCOPE }))
    .mockResolvedValueOnce(Response.json({ emailAddress: "shopper@example.test" })));
  const response = await callback(new NextRequest(`http://localhost:3000/api/auth/callback?code=synthetic&state=${state}`, {
    headers: { cookie: `${TRANSACTION_COOKIE}=${flow.cookie}` },
  }));
  expect(response.headers.get("location")).toBe("http://localhost:3000/sync");
  const session = response.cookies.get(SESSION_COOKIE)!;
  expect(session.httpOnly).toBe(true);
  expect(session.value).not.toContain("synthetic-access");
  expect(response.cookies.get(TRANSACTION_COOKIE)?.maxAge).toBe(0);
  const connected = await status(new NextRequest("http://localhost:3000/api/auth/session", {
    headers: { cookie: `${SESSION_COOKIE}=${session.value}` },
  }));
  expect(await connected.json()).toEqual({ connected: true });
  expect(connected.headers.get("cache-control")).toBe("no-store");
  const anonymous = await status(new NextRequest("http://localhost:3000/api/auth/session"));
  expect(anonymous.status).toBe(401);
  expect(await anonymous.json()).toEqual({ connected: false, reconnectUrl: "/api/auth/google" });
});
