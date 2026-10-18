import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { middleware } from "@/middleware";
import { ANON_COOKIE, anonymousScope, isAnonymousScope } from "./anonymous";
import { appendAudit, getState, MAX_ANONYMOUS_SCOPES, resetStore, withStoreScope } from "./index";

const ID = "0b9c1f6e-3a4d-4c2b-9e8f-7a6b5c4d3e2f";

afterEach(() => resetStore());

describe("anonymousScope", () => {
  it("accepts only v4 UUID cookie values", () => {
    expect(anonymousScope(ID)).toBe(`anon:${ID}`);
    for (const value of [undefined, "", "anonymous", "victim-profile-id", `${ID}x`, ID.toUpperCase()]) expect(anonymousScope(value)).toBeNull();
  });

  it("treats the fallback and per-visitor scopes as anonymous, never a profile id", () => {
    expect(isAnonymousScope("anonymous")).toBe(true);
    expect(isAnonymousScope(`anon:${ID}`)).toBe(true);
    expect(isAnonymousScope("profile-123")).toBe(false);
  });
});

describe("middleware", () => {
  it("sets a random httpOnly anonymous cookie on the response and the forwarded request", () => {
    const response = middleware(new NextRequest("http://localhost:3000/"));
    const cookie = response.cookies.get(ANON_COOKIE);
    expect(anonymousScope(cookie?.value)).not.toBeNull();
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(response.headers.get("x-middleware-request-cookie") ?? response.headers.get("x-middleware-override-headers")).toBeTruthy();
    const other = middleware(new NextRequest("http://localhost:3000/")).cookies.get(ANON_COOKIE)?.value;
    expect(other).not.toBe(cookie?.value);
  });

  it("keeps a valid cookie and replaces a forged one", () => {
    const kept = middleware(new NextRequest("http://localhost:3000/ledger", { headers: { cookie: `${ANON_COOKIE}=${ID}` } }));
    expect(kept.cookies.get(ANON_COOKIE)).toBeUndefined();
    const forged = middleware(new NextRequest("http://localhost:3000/", { headers: { cookie: `${ANON_COOKIE}=anonymous` } }));
    expect(anonymousScope(forged.cookies.get(ANON_COOKIE)?.value)).not.toBeNull();
  });
});

describe("anonymous store scopes", () => {
  it("keeps visitors apart and drops the least recently used one past the cap", () => {
    const first = `anon:${ID}`;
    const filler = (i: number) => `anon:00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const details = () => getState().audit.map((entry) => entry.detail);
    withStoreScope(first, () => appendAudit({ at: new Date().toISOString(), type: "sync_start", detail: "first visitor" }));
    withStoreScope(filler(0), () => {
      expect(details()).toEqual([]);
      appendAudit({ at: new Date().toISOString(), type: "sync_start", detail: "least recently used" });
    });
    for (let i = 1; i < MAX_ANONYMOUS_SCOPES - 1; i += 1) withStoreScope(filler(i), () => getState());
    // Touching the first visitor leaves filler(0) as the least recently used of MAX_ANONYMOUS_SCOPES stores.
    withStoreScope(first, () => expect(details()).toEqual(["first visitor"]));
    withStoreScope(filler(MAX_ANONYMOUS_SCOPES), () => getState());
    withStoreScope(first, () => expect(details()).toEqual(["first visitor"]));
    withStoreScope(filler(0), () => expect(details()).toEqual([]));
  });
});
