import { beforeEach, describe, expect, it } from "vitest";
import { loadSeedDemo } from "@/lib/demo/seed";
import type { PipelineResult } from "@/lib/pipeline/run";
import {
  appendAudit,
  deleteAll,
  excludeMerchant,
  getExtractionCache,
  getFinding,
  getOrder,
  getState,
  includeMerchant,
  resetStore,
  setPipelineResult,
  setRevokeOAuthHook,
  upsertDraft,
} from "./index";

let seed: PipelineResult & { asOf: string };

beforeEach(async () => {
  resetStore();
  seed ??= await loadSeedDemo({ cachePath: "missing-llm-cache.json" });
  setPipelineResult("demo", seed.asOf, seed);
});

describe("store", () => {
  it("starts empty and keeps state on globalThis", () => {
    resetStore();
    expect(getState()).toMatchObject({ mode: "empty", asOf: null, orders: [], findings: [], audit: [] });
    appendAudit({ at: "2026-10-17T00:00:00.000Z", type: "sync_start", detail: "x" });
    expect(getState().audit).toEqual([{ id: "aud_1", at: "2026-10-17T00:00:00.000Z", type: "sync_start", detail: "x" }]);
  });

  it("returns audit entries newest first", () => {
    appendAudit({ at: "2026-10-17T00:00:00.000Z", type: "sync_start", detail: "first" });
    appendAudit({ at: "2026-10-17T00:00:01.000Z", type: "sync_complete", detail: "second" });
    expect(getState().audit.map((entry) => entry.detail)).toEqual(["second", "first"]);
  });

  it("hides excluded merchants' orders, findings and drafts from every read, case-insensitively", () => {
    const northwind = seed.orders.find((order) => order.merchant.name === "Northwind Outfitters");
    const finding = seed.findings.find((candidate) => candidate.orderId === northwind?.id);
    if (!northwind || !finding) throw new Error("seed has no Northwind finding");
    upsertDraft({ id: "d1", findingId: finding.id, subject: "s", body: "b", recipient: "r", signedName: "n" });

    expect(excludeMerchant("  NORTHWIND outfitters ")).toEqual(["northwind outfitters"]);
    const state = getState();
    expect(state.orders.some((order) => order.id === northwind.id)).toBe(false);
    expect(state.findings.some((candidate) => candidate.orderId === northwind.id)).toBe(false);
    expect(state.drafts).toEqual([]);
    expect(getOrder(northwind.id)).toBeUndefined();
    expect(getFinding(finding.id)).toBeUndefined();

    expect(includeMerchant("Northwind Outfitters")).toEqual([]);
    expect(getOrder(northwind.id)).toBeDefined();
    expect(getState().drafts).toHaveLength(1);
  });

  it("excludes by merchant domain too", () => {
    const order = seed.orders.find((candidate) => candidate.merchant.domain);
    if (!order?.merchant.domain) throw new Error("seed order without domain");
    excludeMerchant(order.merchant.domain);
    expect(getOrder(order.id)).toBeUndefined();
  });

  it("deleteAll purges everything except one delete audit record", async () => {
    appendAudit({ at: "2026-10-17T00:00:00.000Z", type: "llm_call", detail: "x", model: "gold" });
    excludeMerchant("Grandmart");
    getExtractionCache().set("hash", { ...seedExtractionStub() });
    const result = await deleteAll(() => new Date("2026-10-18T00:00:00.000Z"));

    expect(result).toMatchObject({ deleted: true, ok: true, at: "2026-10-18T00:00:00.000Z", revokedToken: false });
    expect(result.purged.orders).toBe(seed.orders.length);
    expect(result.purged.findings).toBe(seed.findings.length);
    expect(result.purged.audit).toBe(1);
    const state = getState();
    expect(state).toMatchObject({ mode: "empty", asOf: null, orders: [], findings: [], drafts: [], reviewQueue: [], excludedMerchants: [] });
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({ type: "delete", at: "2026-10-18T00:00:00.000Z" });
    expect(state.audit[0].detail).toContain("no OAuth token connected");
    expect(getExtractionCache().get("hash")).toBeUndefined();
  });

  it("deleteAll calls the registered OAuth revoke hook and keeps it registered", async () => {
    let calls = 0;
    setRevokeOAuthHook(async () => {
      calls += 1;
      return true;
    });
    expect((await deleteAll()).revokedToken).toBe(true);
    expect(getState().audit[0].detail).toContain("OAuth token revoked");
    await deleteAll();
    expect(calls).toBe(2);
  });

  it("deleteAll still purges data when the revoke hook fails", async () => {
    setRevokeOAuthHook(async () => {
      throw new Error("network down");
    });
    const result = await deleteAll();
    expect(result.revokedToken).toBe(false);
    expect(getState().orders).toEqual([]);
    expect(getState().audit[0].detail).toContain("OAuth revoke failed");
  });
});

function seedExtractionStub() {
  return {
    emailId: "e1",
    class: "order" as const,
    fields: { merchant: "M", orderRef: "R", date: null, currency: null, lineItems: [], totals: {} },
    confidence: {},
    evidence: {},
    confMin: 1,
    model: "test",
    cached: false,
  };
}
