import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody, FindingStatusResponse, LedgerResponse } from "@/lib/api/types";
import { authConfig, SESSION_COOKIE } from "@/lib/auth/config";
import { seal } from "@/lib/auth/crypto";
import { createAuthStore, type AuthStore } from "@/lib/auth/store";
import type { Finding } from "@/lib/contracts";
import { loadSeedDemo } from "@/lib/demo/seed";
import { getFinding, getState, resetStore, setPipelineResult, withStoreScope } from "@/lib/store";
import * as approve from "../claims/[findingId]/approve/route";
import * as claim from "../claims/[findingId]/route";
import * as deleteAllRoute from "../delete-all/route";
import * as demo from "../demo/route";
import * as ledger from "../ledger/route";
import * as exclude from "../merchants/exclude/route";
import * as status from "./[id]/status/route";

let db: AuthStore;
vi.mock("@/lib/auth/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth/store")>();
  return { ...original, authStore: () => db };
});

const json = <T>(response: Response) => response.json() as Promise<T>;
const statusParams = (id: string) => ({ params: Promise.resolve({ id: encodeURIComponent(id) }) });
const claimParams = (findingId: string) => ({ params: Promise.resolve({ findingId: encodeURIComponent(findingId) }) });

function post(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/findings/x/status", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function account(mailbox: string): { id: string; cookie: string } {
  const key = authConfig().key;
  const tokens = seal({ accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: Date.now() + 3600000 }, key, "tokens");
  const id = db.save(mailbox, tokens);
  return { id, cookie: seal({ userId: id, expiresAt: Date.now() + 3600000 }, key, "session") };
}

async function loadDemoLedger(): Promise<LedgerResponse> {
  expect((await demo.POST(new Request("http://localhost/api/demo", { method: "POST" }))).status).toBe(200);
  return getLedger();
}

async function getLedger(): Promise<LedgerResponse> {
  return json<LedgerResponse>(await ledger.GET(new Request("http://localhost/api/ledger", { method: "GET" })));
}

/** Seed refund_overdue finding for Northwind order NW-48213 (expected refund $111.24, on a confirmed order). */
function northwindRefund(ledgerBody: LedgerResponse): Finding {
  const order = ledgerBody.orders.find((candidate) => candidate.orderRef === "NW-48213");
  const finding = ledgerBody.findings.find((candidate) => candidate.orderId === order?.id && candidate.kind === "refund_overdue");
  if (!finding) throw new Error("seed has no NW-48213 refund_overdue finding");
  return finding;
}

beforeEach(() => {
  db = createAuthStore(":memory:");
  resetStore();
  vi.stubEnv("AUTH_ENCRYPTION_KEY", "ab".repeat(32));
  vi.stubEnv("AUTH_BASE_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-secret");
});
afterEach(() => {
  db.close();
  resetStore();
  vi.unstubAllEnvs();
});

describe("POST /api/findings/:id/status", () => {
  it("resolves, dismisses and reopens a finding, returns the new summary, and audits each change", async () => {
    const before = await loadDemoLedger();
    const finding = northwindRefund(before);

    const resolved = await status.POST(post({ status: "resolved" }), statusParams(finding.id));
    expect(resolved.status).toBe(200);
    expect(resolved.headers.get("cache-control")).toBe("no-store");
    const body = await json<FindingStatusResponse>(resolved);
    expect(body.finding).toMatchObject({ id: finding.id, status: "resolved" });
    expect(body.summary.owedTotal).toBeCloseTo(before.summary.owedTotal - finding.amountAtStake, 2);
    expect(body.summary.findingCount).toBe(before.summary.findingCount - 1);
    expect(body.summary).toEqual((await getLedger()).summary);

    expect((await status.POST(post({ status: "dismissed" }), statusParams(finding.id))).status).toBe(200);
    expect(getFinding(finding.id)?.status).toBe("dismissed");
    const reopened = await json<FindingStatusResponse>(await status.POST(post({ status: "open" }), statusParams(finding.id)));
    expect(reopened.summary).toEqual(before.summary);

    const audit = getState().audit.filter((entry) => entry.type === "approval").map((entry) => entry.detail);
    expect(audit).toEqual([
      `Finding ${finding.id} marked open (was dismissed) by the user`,
      `Finding ${finding.id} marked dismissed (was resolved) by the user`,
      `Finding ${finding.id} marked resolved (was open) by the user`,
    ]);
  });

  it("rejects bad input with 400 and unknown or excluded findings with 404, without auditing", async () => {
    const finding = northwindRefund(await loadDemoLedger());
    const auditBefore = getState().audit.length;
    for (const bad of ["not json", {}, { status: "drafted" }, { status: "RESOLVED" }, { status: 1 }]) {
      const response = await status.POST(post(bad), statusParams(finding.id));
      expect(response.status, JSON.stringify(bad)).toBe(400);
      expect(typeof (await json<ApiErrorBody>(response)).error).toBe("string");
    }
    expect((await status.POST(post({ status: "resolved" }), { params: Promise.resolve({ id: "" }) })).status).toBe(400);

    const missing = await status.POST(post({ status: "resolved" }), statusParams("refund_overdue:order:nope"));
    expect(missing.status).toBe(404);
    expect(await json<ApiErrorBody>(missing)).toEqual({ error: "Finding not found" });

    await exclude.POST(new Request("http://localhost/api/merchants/exclude", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ merchant: "Northwind Outfitters" }),
    }));
    expect((await status.POST(post({ status: "resolved" }), statusParams(finding.id))).status).toBe(404);
    expect(getState().audit.length).toBe(auditBefore);

    await deleteAllRoute.POST(new Request("http://localhost/api/delete-all", { method: "POST" }));
    expect((await status.POST(post({ status: "resolved" }), statusParams(finding.id))).status).toBe(404);
  });

  it("only changes findings in the caller's account store", async () => {
    const first = account("first@example.test");
    const second = account("second@example.test");
    const seed = await loadSeedDemo({ cachePath: "missing-llm-cache.json" });
    withStoreScope(first.id, () => setPipelineResult("gmail", seed.asOf, seed));
    const finding = seed.findings[0];

    expect((await status.POST(post({ status: "resolved" }, second.cookie), statusParams(finding.id))).status).toBe(404);
    expect((await status.POST(post({ status: "resolved" }), statusParams(finding.id))).status).toBe(404);
    expect(withStoreScope(first.id, () => getFinding(finding.id)?.status)).toBe("open");

    expect((await status.POST(post({ status: "resolved" }, first.cookie), statusParams(finding.id))).status).toBe(200);
    expect(withStoreScope(first.id, () => getFinding(finding.id)?.status)).toBe("resolved");
    expect(withStoreScope(second.id, () => getState().audit)).toEqual([]);
    expect(getState().audit).toEqual([]);
  });
});

describe("Option A end to end (#77)", () => {
  it("an approved claim keeps counting as claim sent until it is resolved, and survives a demo re-run", async () => {
    const before = await loadDemoLedger();
    const finding = northwindRefund(before);
    expect(before.summary.claimSentCount).toBe(0);
    expect(before.summary.claimSentTotal).toBe(0);

    expect((await claim.GET(new Request("http://localhost/api/claims/x"), claimParams(finding.id))).status).toBe(200);
    expect((await approve.POST(new Request("http://localhost/api/claims/x/approve", { method: "POST" }), claimParams(finding.id))).status).toBe(200);

    const approved = await getLedger();
    expect(approved.findings.find((candidate) => candidate.id === finding.id)?.status).toBe("drafted");
    expect(approved.summary).toEqual({
      ...before.summary,
      claimSentCount: 1,
      claimSentTotal: finding.amountAtStake,
    });

    const rerun = await loadDemoLedger();
    expect(rerun.summary).toEqual(approved.summary);

    const resolved = await json<FindingStatusResponse>(await status.POST(post({ status: "resolved" }), statusParams(finding.id)));
    const after = await getLedger();
    expect(resolved.summary).toEqual(after.summary);
    expect(after.summary.owedTotal).toBeCloseTo(before.summary.owedTotal - finding.amountAtStake, 2);
    expect(after.summary).toMatchObject({
      findingCount: before.summary.findingCount - 1,
      claimSentCount: 0,
      claimSentTotal: 0,
      excludedCount: before.summary.excludedCount,
      excludedTotal: before.summary.excludedTotal,
    });
  });
});
