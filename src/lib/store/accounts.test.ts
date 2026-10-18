import { beforeEach, describe, expect, it } from "vitest";
import { openClaim } from "@/lib/api/claims";
import type { ClaimDraftRecord } from "@/lib/api/types";
import { JACKET, NOW, email, resultOf } from "@/lib/pipeline/accounts.fixtures";
import type { PipelineResult } from "@/lib/pipeline/run";
import { clearLedger, deleteAll, getAccountSyncTimes, getState, resetStore, setAccountPipelineResult, setFindingStatus,
  setPipelineResult, upsertDraft, withStoreScope } from "./index";

const ASOF = NOW.toISOString();
const confirmation = (id: string, source: string) =>
  email(id, "order", "2026-08-20T10:00:00Z", { lineItems: [JACKET], totals: { total: 80 }, refundSlaDays: 7 }, source);
const returned = (id: string, source: string) => email(id, "return_received", "2026-09-01T10:00:00Z", { lineItems: [JACKET] }, source);
const inboxA = (): PipelineResult => resultOf([confirmation("a-1", "acct-a"), returned("a-2", "acct-a")]);
const inboxB = (): PipelineResult => resultOf([
  email("b-1", "order", "2026-09-05T10:00:00Z", { orderRef: "NW-2002", totals: { total: 30 }, lineItems: [{ name: "Cap", qty: 1, unitPrice: 30 }] }, "acct-b")]);

beforeEach(() => resetStore());

describe("per-account Gmail results (#114)", () => {
  it("merges accounts into one ledger and keeps the other account's orders when one account re-syncs", () => {
    setAccountPipelineResult("acct-a", ASOF, inboxA(), "2026-10-17T01:00:00.000Z");
    setAccountPipelineResult("acct-b", ASOF, inboxB(), "2026-10-17T02:00:00.000Z");
    expect(getState().orders.map(order => order.sources)).toEqual([["acct-a"], ["acct-b"]]);
    expect(getState().mode).toBe("gmail");

    // Account A syncs again and now sees nothing (e.g. the messages aged out of the search window).
    setAccountPipelineResult("acct-a", ASOF, resultOf([]), "2026-10-17T03:00:00.000Z");
    const state = getState();
    expect(state.orders.map(order => order.id)).toEqual(["order:northwind-outfitters:nw-2002"]);
    expect(state.findings).toEqual([]);
    expect(getAccountSyncTimes()).toEqual({ "acct-a": "2026-10-17T03:00:00.000Z", "acct-b": "2026-10-17T02:00:00.000Z" });
    expect(state.lastSyncAt).toBe("2026-10-17T03:00:00.000Z");
  });

  it("carries finding statuses and drafts over by finding id when another account syncs", () => {
    setAccountPipelineResult("acct-a", ASOF, inboxA());
    const finding = getState().findings[0];
    expect(finding.status).toBe("open");
    setFindingStatus(finding.id, "drafted");
    const opened = openClaim(finding.id);
    if (!opened.ok) throw new Error("Synthetic claim fixture unavailable");
    const draft: ClaimDraftRecord = { ...opened.claim.draft, body: "Synthetic user edits", edited: true };
    upsertDraft(draft);
    setAccountPipelineResult("acct-b", ASOF, inboxB());
    expect(getState().findings.find(item => item.id === finding.id)?.status).toBe("drafted");
    expect(getState().drafts.map(draft => draft.body)).toEqual(["Synthetic user edits"]);
  });

  it("does not double count an order both inboxes saw", () => {
    setAccountPipelineResult("acct-a", ASOF, inboxA());
    setAccountPipelineResult("acct-b", ASOF, resultOf([confirmation("b-1", "acct-b"), returned("b-2", "acct-b")]));
    const state = getState();
    expect(state.orders).toHaveLength(1);
    expect(state.orders[0].sources).toEqual(["acct-a", "acct-b"]);
    expect(state.findings).toHaveLength(1);
    expect(state.stats?.emails).toBe(4);
  });

  it("is replaced by a demo/upload ledger, cleared by clearLedger, and gone after delete-all", async () => {
    setAccountPipelineResult("acct-a", ASOF, inboxA());
    setPipelineResult("demo", ASOF, resultOf([]));
    expect(getAccountSyncTimes()).toEqual({});
    setAccountPipelineResult("acct-a", ASOF, inboxA());
    setAccountPipelineResult("acct-b", ASOF, inboxB());
    clearLedger();
    expect(getAccountSyncTimes()).toEqual({});
    setAccountPipelineResult("acct-b", ASOF, inboxB());
    expect(getState().orders).toHaveLength(1);
    await deleteAll();
    expect(getAccountSyncTimes()).toEqual({});
    expect(getState().orders).toEqual([]);
  });

  it("keeps accounts per store scope", () => {
    withStoreScope("profile-1", () => setAccountPipelineResult("acct-a", ASOF, inboxA()));
    expect(withStoreScope("profile-2", () => getAccountSyncTimes())).toEqual({});
    expect(Object.keys(withStoreScope("profile-1", () => getAccountSyncTimes()))).toEqual(["acct-a"]);
  });
});