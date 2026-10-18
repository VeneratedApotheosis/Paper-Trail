import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import * as approveRoute from "@/app/api/claims/[findingId]/approve/route";
import * as claimRoute from "@/app/api/claims/[findingId]/route";
import * as findingRoute from "@/app/api/findings/[id]/route";
import * as ledgerRoute from "@/app/api/ledger/route";
import * as orderRoute from "@/app/api/orders/[id]/route";
import { authConfig, SESSION_COOKIE } from "@/lib/auth/config";
import { seal } from "@/lib/auth/crypto";
import { createAuthStore, type AuthStore } from "@/lib/auth/store";
import type { Finding } from "@/lib/contracts";
import { loadSeedDemo, type SeedDemoResult } from "@/lib/demo";
import { appendAudit, excludeMerchant, getState, resetStore, setPipelineResult, withStoreScope } from "@/lib/store";
import {
  getAuditForRequest,
  getClaimForRequest,
  getFindingForRequest,
  getLedgerForRequest,
  getOrderForRequest,
} from "./server";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

let db: AuthStore;
vi.mock("@/lib/auth/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth/store")>();
  return { ...original, authStore: () => db };
});

let seed: SeedDemoResult;
beforeAll(async () => {
  seed = await loadSeedDemo({ cachePath: "missing-llm-cache.json" });
});

/** Server components read the session cookie through `cookies()`; undefined = no cookie. */
function setRequestCookie(value: string | undefined): void {
  const jar = new Map(value === undefined ? [] : [[SESSION_COOKIE, { name: SESSION_COOKIE, value }]]);
  vi.mocked(cookies).mockResolvedValue(jar as unknown as Awaited<ReturnType<typeof cookies>>);
}

function sessionCookie(userId: string, expiresAt = Date.now() + 3600000): string {
  return seal({ userId, expiresAt }, authConfig().key, "session");
}

/** Synthetic signed-in account with a usable refresh grant. */
function account(mailbox: string): { id: string; cookie: string } {
  const tokens = seal(
    { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: Date.now() + 3600000 },
    authConfig().key,
    "tokens",
  );
  const id = db.save(mailbox, tokens);
  return { id, cookie: sessionCookie(id) };
}

function routeRequest(path: string, cookie?: string): Request {
  return new Request(`http://localhost${path}`, cookie ? { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } } : {});
}

const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const idParams = (id: string) => ({ params: Promise.resolve({ id: encodeURIComponent(id) }) });
const findingIdParams = (findingId: string) => ({ params: Promise.resolve({ findingId: encodeURIComponent(findingId) }) });

function loadAnonymousDemo(): void {
  setPipelineResult("demo", seed.asOf, seed);
}

/** A finding whose order id contains ':' (every real id does). */
function firstFinding(): Finding {
  const finding = seed.findings[0];
  if (!finding || !finding.orderId.includes(":")) throw new Error("seed finding ids are expected to contain ':'");
  return finding;
}

beforeEach(() => {
  db = createAuthStore(":memory:");
  resetStore();
  vi.stubEnv("AUTH_ENCRYPTION_KEY", "ab".repeat(32));
  vi.stubEnv("AUTH_BASE_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-secret");
  setRequestCookie(undefined);
});
afterEach(() => {
  db.close();
  resetStore();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("server data helpers: anonymous scope", () => {
  it("returns the same ledger, order and finding bodies as the JSON routes", async () => {
    loadAnonymousDemo();
    const finding = firstFinding();

    const ledger = await getLedgerForRequest();
    expect(ledger.mode).toBe("demo");
    expect(asJson(ledger)).toEqual(await (await ledgerRoute.GET(routeRequest("/api/ledger"))).json());

    const order = await getOrderForRequest(finding.orderId);
    expect(order?.order.id).toBe(finding.orderId);
    const orderResponse = await orderRoute.GET(routeRequest("/api/orders/x"), idParams(finding.orderId));
    expect(asJson(order)).toEqual(await orderResponse.json());

    const findingBody = await getFindingForRequest(finding.id);
    expect(findingBody?.finding.id).toBe(finding.id);
    const findingResponse = await findingRoute.GET(routeRequest("/api/findings/x"), idParams(finding.id));
    expect(asJson(findingBody)).toEqual(await findingResponse.json());
  });

  it("accepts ids that are still percent-encoded (Next 15 params) as well as raw ids", async () => {
    loadAnonymousDemo();
    const finding = firstFinding();
    const encodedOrderId = encodeURIComponent(finding.orderId);
    expect(encodedOrderId).toContain("%3A");

    expect((await getOrderForRequest(encodedOrderId))?.order.id).toBe(finding.orderId);
    expect((await getFindingForRequest(encodeURIComponent(finding.id)))?.finding.id).toBe(finding.id);
    const claim = await getClaimForRequest(encodeURIComponent(finding.id));
    expect(claim.ok && claim.claim.finding.id).toBe(finding.id);
  });

  it("returns null or not_found for unknown, excluded, empty, too long and malformed ids", async () => {
    loadAnonymousDemo();
    const finding = firstFinding();

    for (const id of ["order:unknown", "", "x".repeat(301), "%E0%A4%A"]) {
      expect(await getOrderForRequest(id)).toBeNull();
      expect(await getFindingForRequest(id)).toBeNull();
      expect(await getClaimForRequest(id)).toEqual({ ok: false, reason: "not_found", message: "Finding not found" });
    }

    const order = seed.orders.find((candidate) => candidate.id === finding.orderId);
    if (!order) throw new Error("seed finding has no order");
    excludeMerchant(order.merchant.name);
    expect(await getOrderForRequest(order.id)).toBeNull();
    expect(await getFindingForRequest(finding.id)).toBeNull();
    expect((await getClaimForRequest(finding.id)).ok).toBe(false);
  });

  it("returns the audit log newest first, like GET /api/audit", async () => {
    appendAudit({ at: "2026-10-17T10:00:00.000Z", type: "approval", detail: "first (synthetic)" });
    appendAudit({ at: "2026-10-17T11:00:00.000Z", type: "approval", detail: "second (synthetic)" });
    const { entries } = await getAuditForRequest();
    expect(entries.map((entry) => entry.detail)).toEqual(["second (synthetic)", "first (synthetic)"]);
  });
});

describe("server data helpers: getClaimForRequest", () => {
  it("returns and stores the template draft like GET /api/claims/:findingId, so approve works afterwards", async () => {
    loadAnonymousDemo();
    const finding = firstFinding();

    const opened = await getClaimForRequest(finding.id);
    if (!opened.ok) throw new Error(opened.message);
    expect(opened.claim.draft.findingId).toBe(finding.id);
    expect(opened.claim.draft.edited).toBe(false);
    expect(getState().drafts.map((draft) => draft.findingId)).toEqual([finding.id]);

    const routeBody = await (await claimRoute.GET(routeRequest("/api/claims/x"), findingIdParams(finding.id))).json();
    expect(asJson(opened.claim)).toEqual(routeBody);
    const approved = await approveRoute.POST(new Request("http://localhost/api/claims/x/approve", { method: "POST" }), findingIdParams(finding.id));
    expect(approved.status).toBe(200);
  });

  it("returns the draftClaim reason for findings without a claim template (route 422)", async () => {
    const base = firstFinding();
    const rewardsGap: Finding = { ...base, id: `rewards_gap:${base.orderId}`, kind: "rewards_gap" };
    setPipelineResult("demo", seed.asOf, { ...seed, findings: [...seed.findings, rewardsGap] });

    expect(await getClaimForRequest(rewardsGap.id)).toEqual({
      ok: false,
      reason: "unsupported_kind",
      message: "Claim drafts are not supported for rewards_gap findings.",
    });
    expect(getState().drafts).toEqual([]);
  });
});

describe("server data helpers: account scope from cookies()", () => {
  it("serves a signed-in account its own store, never the anonymous demo", async () => {
    loadAnonymousDemo();
    const finding = firstFinding();
    const user = account("one@example.test");
    setRequestCookie(user.cookie);

    const empty = await getLedgerForRequest();
    expect(empty.mode).toBe("empty");
    expect(empty.orders).toEqual([]);
    expect(await getOrderForRequest(finding.orderId)).toBeNull();
    expect(await getFindingForRequest(finding.id)).toBeNull();
    expect((await getClaimForRequest(finding.id)).ok).toBe(false);
    expect((await getAuditForRequest()).entries).toEqual([]);

    withStoreScope(user.id, () => setPipelineResult("gmail", seed.asOf, seed));
    const ledger = await getLedgerForRequest();
    expect(ledger.mode).toBe("gmail");
    const routeLedger = await (await ledgerRoute.GET(routeRequest("/api/ledger", user.cookie))).json();
    expect(asJson(ledger)).toEqual(routeLedger);
    expect((await getOrderForRequest(encodeURIComponent(finding.orderId)))?.order.id).toBe(finding.orderId);

    // A claim opened by the server helper is stored in the account scope only.
    expect((await getClaimForRequest(finding.id)).ok).toBe(true);
    expect(withStoreScope(user.id, () => getState().drafts)).toHaveLength(1);
    expect(getState().drafts).toEqual([]);
    expect(getState().mode).toBe("demo");
  });

  it("keeps two accounts apart", async () => {
    const first = account("one@example.test");
    const second = account("two@example.test");
    withStoreScope(first.id, () => setPipelineResult("gmail", seed.asOf, seed));

    setRequestCookie(first.cookie);
    expect((await getLedgerForRequest()).mode).toBe("gmail");
    setRequestCookie(second.cookie);
    expect((await getLedgerForRequest()).mode).toBe("empty");
  });

  it("keeps a signed-in account whose Gmail credentials were cleared in its own store", async () => {
    loadAnonymousDemo();
    const user = account("one@example.test");
    db.update(user.id, null);
    setRequestCookie(user.cookie);
    expect((await getLedgerForRequest()).mode).toBe("empty");
  });

  it("falls back to the anonymous store for tampered, expired and deleted-account cookies", async () => {
    loadAnonymousDemo();
    const finding = firstFinding();
    const deleted = account("gone@example.test");
    db.remove(deleted.id);
    const stale = [
      "tampered",
      "",
      sessionCookie(account("expired@example.test").id, Date.now() - 1000),
      deleted.cookie,
    ];

    for (const cookie of stale) {
      setRequestCookie(cookie);
      expect((await getLedgerForRequest()).mode).toBe("demo");
      expect((await getOrderForRequest(finding.orderId))?.order.id).toBe(finding.orderId);
    }
  });

  it("fails closed when auth is misconfigured and a session cookie is present", async () => {
    loadAnonymousDemo();
    const user = account("one@example.test");
    setRequestCookie(user.cookie);
    vi.stubEnv("AUTH_ENCRYPTION_KEY", "");
    await expect(getLedgerForRequest()).rejects.toThrow();
  });
});
