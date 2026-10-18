import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as account } from "@/app/api/account/route";
import { GET as callback } from "@/app/api/auth/callback/route";
import { POST as disconnect } from "@/app/api/auth/disconnect/route";
import { GET as start } from "@/app/api/auth/google/route";
import { GET as startLink } from "@/app/api/auth/link/route";
import { GET as sessionStatus } from "@/app/api/auth/session/route";
import { POST as deleteAll } from "@/app/api/delete-all/route";
import { resetStore } from "@/lib/store";
import { listAccountGrants } from "./account";
import { GMAIL_SCOPE, SESSION_COOKIE, TRANSACTION_COOKIE, authConfig } from "./config";
import { seal, unseal } from "./crypto";
import { storedTokens } from "./google";
import { getAccessToken, sessionUser } from "./service";
import { createAuthStore, type AuthStore } from "./store";

let db: AuthStore;
vi.mock("./store", async importOriginal => {
  const original = await importOriginal<typeof import("./store")>();
  return { ...original, authStore: () => db };
});
const key = "ab".repeat(32);
const sealedTokens = (mailbox: string, tokens: Partial<{ accessToken: string; refreshToken: string; expiresAt: number; refreshExpiresAt: number }> = {}) =>
  seal({ accessToken: `access-${mailbox}`, refreshToken: `refresh-${mailbox}`, expiresAt: Date.now() + 3600000, mailbox, ...tokens }, key, "tokens");
const sessionFor = (userId: string) => seal({ userId, expiresAt: Date.now() + 3600000 }, key, "session");
function req(path: string, cookie?: string, method = "GET", body?: unknown) {
  return new NextRequest(`http://localhost:3000/api/${path}`, { method,
    headers: { origin: "http://localhost:3000", ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const mailboxOf = (userId: string, accountId: string) => {
  const stored = db.findAccount(userId, accountId)?.tokenEnc;
  return stored ? storedTokens.parse(unseal(stored, key, "tokens")).mailbox : null;
};
/** Runs the OAuth redirect and callback for `mailbox`, optionally signed in and/or in link mode. */
async function oauth(mailbox: string, options: { link?: boolean; session?: string } = {}) {
  const started = options.link ? await startLink() : await start();
  const location = new URL(started.headers.get("location")!);
  const transaction = started.cookies.get(TRANSACTION_COOKIE)!.value;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ access_token: `access-${mailbox}`, refresh_token: `refresh-${mailbox}`, expires_in: 3600,
      token_type: "Bearer", scope: GMAIL_SCOPE }))
    .mockResolvedValueOnce(Response.json({ emailAddress: mailbox })));
  const cookies = [`${TRANSACTION_COOKIE}=${transaction}`, ...(options.session ? [`${SESSION_COOKIE}=${options.session}`] : [])].join("; ");
  const response = await callback(new NextRequest(
    `http://localhost:3000/api/auth/callback?code=synthetic&state=${location.searchParams.get("state")}`, { headers: { cookie: cookies } }));
  const sessionCookie = response.cookies.get(SESSION_COOKIE)?.value;
  return { response, location, sessionCookie, userId: sessionCookie ? sessionUser(sessionCookie, authConfig()) : null };
}

beforeEach(() => {
  resetStore(); db = createAuthStore(":memory:");
  vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-secret");
  vi.stubEnv("AUTH_ENCRYPTION_KEY", key); vi.stubEnv("AUTH_BASE_URL", "http://localhost:3000");
});
afterEach(() => { db.close(); resetStore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("auth store accounts", () => {
  it("lists the profile's own mailbox first, then linked ones in link order, and links each mailbox once", () => {
    const profile = db.save("one@example.test", sealedTokens("one@example.test"));
    expect(db.accounts(profile).map(item => item.id)).toEqual([profile]);
    const second = db.link(profile, "two@example.test", sealedTokens("two@example.test"));
    const third = db.link(profile, "three@example.test", sealedTokens("three@example.test"));
    expect(db.accounts(profile).map(item => item.id)).toEqual([profile, second, third]);
    expect(db.link(profile, "two@example.test", sealedTokens("two@example.test", { accessToken: "fresh" }))).toBe(second);
    expect(db.link(profile, "one@example.test", sealedTokens("one@example.test", { accessToken: "fresh" }))).toBe(profile);
    expect(db.accounts(profile)).toHaveLength(3);
    expect(db.accounts("unknown")).toEqual([]);
    expect(() => db.link("unknown", "x@example.test", "sealed")).toThrow();
  });

  it("keeps mailboxes out of plain columns and removes linked accounts with the profile", () => {
    const profile = db.save("one@example.test", sealedTokens("one@example.test"));
    const second = db.link(profile, "two@example.test", sealedTokens("two@example.test"));
    expect(JSON.stringify(db.accounts(profile))).not.toContain("two@example.test");
    db.updateAccount(profile, second, null);
    expect(db.findAccount(profile, second)).toMatchObject({ id: second, tokenEnc: null });
    db.remove(profile);
    expect(db.accounts(profile)).toEqual([]);
    expect(db.findAccount(profile, second)).toBeUndefined();
  });

  it("keeps another profile's accounts apart", () => {
    const first = db.save("one@example.test", sealedTokens("one@example.test"));
    const other = db.save("other@example.test", sealedTokens("other@example.test"));
    const linked = db.link(first, "two@example.test", sealedTokens("two@example.test"));
    expect(db.findAccount(other, linked)).toBeUndefined();
    db.updateAccount(other, linked, null); // wrong profile: ignored
    expect(db.findAccount(first, linked)?.tokenEnc).not.toBeNull();
  });
});

describe("linking another Gmail account through OAuth", () => {
  it("asks Google to choose an account only in link mode", async () => {
    const plain = await oauth("one@example.test");
    expect(plain.location.searchParams.get("prompt")).toBe("consent");
    const linking = await oauth("two@example.test", { link: true });
    expect(linking.location.searchParams.get("prompt")).toBe("consent select_account");
    expect(linking.location.searchParams.get("scope")).toBe(GMAIL_SCOPE);
  });

  it("links the new mailbox to the signed-in profile without switching identity", async () => {
    const first = await oauth("one@example.test");
    const second = await oauth("two@example.test", { link: true, session: first.sessionCookie });
    expect(second.response.headers.get("location")).toBe("http://localhost:3000/sync");
    expect(second.userId).toBe(first.userId);
    const accounts = db.accounts(first.userId!);
    expect(accounts).toHaveLength(2);
    expect(accounts.map(item => mailboxOf(first.userId!, item.id))).toEqual(["one@example.test", "two@example.test"]);
    // Both accounts sign in under one profile and both are connected.
    expect(listAccountGrants(first.userId!, authConfig(), db).map(item => [item.mailbox, item.connected]))
      .toEqual([["one@example.test", true], ["two@example.test", true]]);
  });

  it("linking the same mailbox again refreshes its tokens instead of adding a copy", async () => {
    const first = await oauth("one@example.test");
    await oauth("two@example.test", { link: true, session: first.sessionCookie });
    const [, linked] = db.accounts(first.userId!);
    db.updateAccount(first.userId!, linked.id, null); // it expired or was disconnected
    await oauth("two@example.test", { link: true, session: first.sessionCookie });
    expect(db.accounts(first.userId!)).toHaveLength(2);
    expect(mailboxOf(first.userId!, linked.id)).toBe("two@example.test");
    expect(await getAccessToken(first.userId!, authConfig(), db, fetch, Date.now(), linked.id)).toBe("access-two@example.test");
    // Linking the profile's own mailbox updates the profile's account.
    await oauth("one@example.test", { link: true, session: first.sessionCookie });
    expect(db.accounts(first.userId!)).toHaveLength(2);
  });

  it("without a session, or without link mode, it signs in as before", async () => {
    const first = await oauth("one@example.test");
    const noSession = await oauth("two@example.test", { link: true });
    expect(noSession.userId).not.toBe(first.userId);
    expect(db.accounts(first.userId!)).toHaveLength(1);
    const plain = await oauth("three@example.test", { session: first.sessionCookie });
    expect(plain.userId).not.toBe(first.userId);
    expect(db.accounts(first.userId!)).toHaveLength(1);
  });

  it("ignores link mode when the session's profile no longer exists", async () => {
    const first = await oauth("one@example.test");
    db.remove(first.userId!);
    const relinked = await oauth("two@example.test", { link: true, session: first.sessionCookie });
    expect(relinked.userId).not.toBe(first.userId);
    expect(db.accounts(relinked.userId!)).toHaveLength(1);
  });
});

describe("per-account tokens", () => {
  it("refreshes and expires each account on its own", async () => {
    const profile = db.save("one@example.test", sealedTokens("one@example.test"));
    const stale = db.link(profile, "two@example.test", sealedTokens("two@example.test", { expiresAt: Date.now() - 1000 }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ access_token: "refreshed-two", expires_in: 3600, token_type: "Bearer" }));
    expect(await getAccessToken(profile, authConfig(), db, fetcher)).toBe("access-one@example.test");
    expect(fetcher).not.toHaveBeenCalled();
    expect(await getAccessToken(profile, authConfig(), db, fetcher, Date.now(), stale)).toBe("refreshed-two");
    expect((fetcher.mock.calls[0][1]?.body as URLSearchParams).get("refresh_token")).toBe("refresh-two@example.test");

    // The second account's refresh grant is revoked: only that account is cleared.
    db.updateAccount(profile, stale, sealedTokens("two@example.test", { expiresAt: Date.now() - 1000 }));
    fetcher.mockResolvedValue(Response.json({ error: "invalid_grant" }, { status: 400 }));
    await expect(getAccessToken(profile, authConfig(), db, fetcher, Date.now(), stale)).rejects.toThrow("token_expired");
    expect(db.findAccount(profile, stale)?.tokenEnc).toBeNull();
    expect(db.find(profile)?.tokenEnc).not.toBeNull();
    expect(await getAccessToken(profile, authConfig(), db, fetcher)).toBe("access-one@example.test");
    await expect(getAccessToken(profile, authConfig(), db, fetcher, Date.now(), "unknown")).rejects.toThrow("token_expired");
  });

  it("reports the session as connected while any account still is", async () => {
    const profile = db.save("one@example.test", sealedTokens("one@example.test"));
    const linked = db.link(profile, "two@example.test", sealedTokens("two@example.test"));
    db.updateAccount(profile, profile, null);
    const cookie = sessionFor(profile);
    expect(await (await sessionStatus(req("auth/session", cookie))).json()).toEqual({ connected: true });
    db.updateAccount(profile, linked, null);
    expect((await sessionStatus(req("auth/session", cookie))).status).toBe(401);
  });
});

describe("GET /api/account with several accounts", () => {
  it("lists every account and mirrors the first connected one in `gmail`", async () => {
    const profile = db.save("one@example.test", sealedTokens("one@example.test", { refreshExpiresAt: Date.now() - 1000 }));
    const linked = db.link(profile, "two@example.test", sealedTokens("two@example.test"));
    vi.stubGlobal("fetch", vi.fn());
    const body = await (await account(req("account", sessionFor(profile)))).json();
    expect(body.accounts).toEqual([
      { id: profile, mailbox: "one@example.test", connected: false, expired: true, lastSyncAt: null },
      { id: linked, mailbox: "two@example.test", connected: true, expired: false, lastSyncAt: null },
    ]);
    expect(body.gmail).toEqual({ connected: true, expired: false, mailbox: "two@example.test" });
    expect(JSON.stringify(body)).not.toMatch(/access-|refresh-/);
  });

  it("falls back to the first account when none is connected", async () => {
    const profile = db.save("one@example.test", sealedTokens("one@example.test"));
    const linked = db.link(profile, "two@example.test", sealedTokens("two@example.test"));
    db.updateAccount(profile, profile, null);
    db.updateAccount(profile, linked, null);
    const body = await (await account(req("account", sessionFor(profile)))).json();
    expect(body.gmail).toEqual({ connected: false, expired: true, mailbox: null });
  });
});

describe("POST /api/auth/disconnect with several accounts", () => {
  function twoAccounts() {
    const profile = db.save("one@example.test", sealedTokens("one@example.test"));
    const linked = db.link(profile, "two@example.test", sealedTokens("two@example.test"));
    return { profile, linked, cookie: sessionFor(profile) };
  }

  it("disconnects only the requested account and revokes only its grant", async () => {
    const { profile, linked, cookie } = twoAccounts();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const response = await disconnect(req("auth/disconnect", cookie, "POST", { accountId: linked }));
    expect(await response.json()).toMatchObject({ disconnected: true, revokedToken: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((fetcher.mock.calls[0][1]?.body as URLSearchParams).get("token")).toBe("refresh-two@example.test");
    expect(db.findAccount(profile, linked)?.tokenEnc).toBeNull();
    expect(db.find(profile)?.tokenEnc).not.toBeNull();
    const body = await (await account(req("account", cookie))).json();
    expect(body.accounts.map((item: { connected: boolean }) => item.connected)).toEqual([true, false]);
    expect(body.accounts[1]).toMatchObject({ id: linked, mailbox: null, expired: true });
  });

  it("disconnects every account by default and rejects an unknown account", async () => {
    const { profile, linked, cookie } = twoAccounts();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    expect((await disconnect(req("auth/disconnect", cookie, "POST", { accountId: "nope" }))).status).toBe(404);
    expect((await disconnect(req("auth/disconnect", cookie, "POST", { accountId: "" }))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await (await disconnect(req("auth/disconnect", cookie, "POST"))).json()).toMatchObject({ disconnected: true, revokedToken: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(db.find(profile)?.tokenEnc).toBeNull();
    expect(db.findAccount(profile, linked)?.tokenEnc).toBeNull();
  });

  it("does not report a revocation when one of the grants could not be revoked", async () => {
    const { cookie } = twoAccounts();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (_url, init) =>
      new Response(null, { status: (init?.body as URLSearchParams).get("token") === "refresh-two@example.test" ? 400 : 200 })));
    expect(await (await disconnect(req("auth/disconnect", cookie, "POST"))).json()).toMatchObject({ disconnected: true, revokedToken: false });
  });
});

describe("POST /api/delete-all with several accounts", () => {
  it("revokes every account's grant and removes the profile with all linked accounts", async () => {
    const profile = db.save("one@example.test", sealedTokens("one@example.test"));
    const linked = db.link(profile, "two@example.test", sealedTokens("two@example.test"));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const response = await deleteAll(req("delete-all", sessionFor(profile), "POST", {}));
    expect(response.status).toBe(200);
    expect((await response.json()).revokedToken).toBe(true);
    expect(fetcher.mock.calls.map(call => (call[1]?.body as URLSearchParams).get("token")).sort())
      .toEqual(["refresh-one@example.test", "refresh-two@example.test"]);
    expect(db.find(profile)).toBeUndefined();
    expect(db.accounts(profile)).toEqual([]);
    expect(db.findAccount(profile, linked)).toBeUndefined();
  });
});
