import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLedgerResponse } from "@/lib/api/ledger";
import { loadSeedDemo } from "@/lib/demo/seed";
import { JACKET, NOW, email, resultOf } from "@/lib/pipeline/accounts.fixtures";
import type { MatchInput } from "@/lib/orders/matcher";
import type { PipelineResult } from "@/lib/pipeline/run";
import {
  deleteAll, getOrder, getState, resetStore, setAccountPipelineResult, setFindingStatus, setPipelineResult, withStoreScope,
} from "@/lib/store";
import { setLabelStore } from "@/lib/quality/labels";
import { orderCorrectedByUser } from "@/lib/view";
import { createOverrideStore, listOverrides, resetOverrideStores } from "./override-store";
import { applyOverrides } from "./overrides";
import { confirmReviewedOrder, editReviewedOrder } from "./service";

const ASOF = NOW.toISOString();
const ORDER_ID = "order:northwind-outfitters:nw-1001";
const at = new Date("2026-10-17T12:00:00.000Z");

const lowConfidence = (input: MatchInput): MatchInput => ({ ...input, extraction: { ...input.extraction, confMin: 0.5 } });
/** Account A's inbox: a rain jacket returned and never refunded, extracted with low confidence (needs review). */
const inboxA = (): PipelineResult => resultOf([
  lowConfidence(email("a-1", "order", "2026-08-20T10:00:00Z", { lineItems: [JACKET], totals: { total: 80 }, refundSlaDays: 7 }, "acct-a")),
  email("a-2", "return_received", "2026-09-01T10:00:00Z", { lineItems: [JACKET] }, "acct-a"),
]);
/** Same, but extracted confidently: nothing to review. */
const confidentInboxA = (): PipelineResult => resultOf([
  email("a-1", "order", "2026-08-20T10:00:00Z", { lineItems: [JACKET], totals: { total: 80 }, refundSlaDays: 7 }, "acct-a"),
  email("a-2", "return_received", "2026-09-01T10:00:00Z", { lineItems: [JACKET] }, "acct-a"),
]);
const inboxB = (): PipelineResult => resultOf([
  email("b-1", "order", "2026-09-05T10:00:00Z", { orderRef: "NW-2002", totals: { total: 30 }, lineItems: [{ name: "Cap", qty: 1, unitPrice: 30 }] }, "acct-b")]);

const owed = () => buildLedgerResponse().summary.owedTotal;
const jacket = () => getOrder(ORDER_ID)!;
const appliedRows = () => getState().audit.filter(entry => entry.detail.startsWith("Applied"));

/** The user fixes the jacket total to $60 in Review and confirms it. */
function correctJacketPrice() {
  const edited = editReviewedOrder(ORDER_ID, jacket().review!.revision, { field: "total", value: 60 }, at);
  confirmReviewedOrder(ORDER_ID, edited.revision, at);
}

let dir: string;
beforeEach(() => {
  resetStore();
  dir = mkdtempSync(join(tmpdir(), "pt124-"));
  vi.stubEnv("DATABASE_URL", join(dir, "papertrail.sqlite"));
});
afterEach(() => {
  resetOverrideStores();
  setLabelStore(undefined); // delete-all opens the label store on the same database file
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("durable Review corrections (#124)", () => {
  it("keeps an edited and confirmed amount when the same account syncs again, and the owed total follows it", () => withStoreScope("user-1", () => {
    setAccountPipelineResult("acct-a", ASOF, inboxA());
    expect(owed()).toBe(0); // low confidence: held out until a human confirms
    correctJacketPrice();
    expect(owed()).toBe(60);

    setAccountPipelineResult("acct-a", ASOF, inboxA()); // fresh extraction says $80 again
    expect(jacket().total).toBe(60);
    expect(jacket().review).toMatchObject({ confirmedAt: at.toISOString(), correctedFields: ["total"] });
    expect(jacket().needsReview).toBe(false);
    expect(orderCorrectedByUser(jacket())).toBe(true);
    expect(getState().findings.map(finding => finding.amountAtStake)).toEqual([60]);
    expect(owed()).toBe(60);
    expect(getState().reviewQueue).toEqual([]);
    expect(appliedRows().map(entry => entry.detail)).toEqual(["Applied 2 of your Review corrections to this sync"]);
  }));

  it("keeps corrections when another account syncs, and when the corrected account syncs again", () => withStoreScope("user-1", () => {
    setAccountPipelineResult("acct-a", ASOF, inboxA());
    setAccountPipelineResult("acct-b", ASOF, inboxB());
    correctJacketPrice();

    setAccountPipelineResult("acct-b", ASOF, inboxB());
    expect(jacket().total).toBe(60);
    expect(owed()).toBe(60);
    setAccountPipelineResult("acct-a", ASOF, inboxA());
    expect(jacket().total).toBe(60);
    expect(owed()).toBe(60);
    expect(getState().orders.map(order => order.sources)).toEqual([["acct-a"], ["acct-b"]]);
  }));

  it("counts a confirmed low-confidence order after a resync, and re-asks when the user edits it again", () => withStoreScope("user-1", () => {
    setAccountPipelineResult("acct-a", ASOF, inboxA());
    confirmReviewedOrder(ORDER_ID, jacket().review!.revision, at);
    expect(owed()).toBe(80);
    setAccountPipelineResult("acct-a", ASOF, inboxA());
    expect(jacket().review?.confirmedAt).toBe(at.toISOString());
    expect(jacket().review?.correctedFields).toBeUndefined();
    expect(orderCorrectedByUser(jacket())).toBe(false); // a confirmation alone is not a correction
    expect(owed()).toBe(80);

    editReviewedOrder(ORDER_ID, jacket().review!.revision, { field: "total", value: 70 }, at);
    setAccountPipelineResult("acct-a", ASOF, inboxA()); // the edit withdrew the confirmation
    expect(jacket()).toMatchObject({ total: 70, needsReview: true });
    expect(jacket().review?.confirmedAt).toBeUndefined();
    expect(owed()).toBe(0);
    expect(getState().reviewQueue).toEqual([expect.objectContaining({ orderId: ORDER_ID, reason: "Corrected order awaiting human confirmation" })]);
  }));

  it("keeps a dismissed finding dismissed across syncs and restarts, and lets Reopen withdraw it", () => withStoreScope("user-1", () => {
    setAccountPipelineResult("acct-a", ASOF, confidentInboxA());
    const [finding] = getState().findings;
    expect(owed()).toBe(80);
    setFindingStatus(finding.id, "dismissed");

    resetStore(); // restart: the in-memory ledger is gone, the database file stays
    setAccountPipelineResult("acct-a", ASOF, confidentInboxA());
    expect(getState().findings[0].status).toBe("dismissed");
    expect(owed()).toBe(0);

    setFindingStatus(finding.id, "open");
    resetStore();
    setAccountPipelineResult("acct-a", ASOF, confidentInboxA());
    expect(getState().findings[0].status).toBe("open");
  }));

  it("survives a restart: a fresh store reading the same database file still applies the edit", () => {
    withStoreScope("user-1", () => {
      setAccountPipelineResult("acct-a", ASOF, inboxA());
      correctJacketPrice();
    });
    withStoreScope("user-1", resetStore); // new in-memory store and closed database connections
    withStoreScope("user-1", () => {
      expect(getState().orders).toEqual([]);
      setAccountPipelineResult("acct-a", ASOF, inboxA());
      expect(jacket().total).toBe(60);
      expect(owed()).toBe(60);
    });
    withStoreScope("user-2", () => { // corrections belong to one profile
      setAccountPipelineResult("acct-a", ASOF, inboxA());
      expect(jacket().total).toBe(80);
    });
  });

  it("applies to uploads too, and delete-all removes the saved corrections", async () => {
    await withStoreScope("user-1", async () => {
      setPipelineResult("upload", ASOF, inboxA());
      correctJacketPrice();
      expect(listOverrides("user-1").map(record => record.kind).sort()).toEqual(["confirm", "edit"]);
      setPipelineResult("upload", ASOF, inboxA());
      expect(owed()).toBe(60);

      const result = await deleteAll(() => at, null);
      expect(result.ok).toBe(true);
      expect(getState().audit[0].detail).toContain("2 saved review corrections");
      expect(listOverrides("user-1")).toEqual([]);
      setPipelineResult("upload", ASOF, inboxA());
      expect(jacket().total).toBe(80);
      expect(owed()).toBe(0);
    });
  });

  it("keeps corrections of an order that is not in this sync, reports them, and applies them when it comes back", () => withStoreScope("user-1", () => {
    setAccountPipelineResult("acct-a", ASOF, inboxA());
    correctJacketPrice();
    setAccountPipelineResult("acct-a", ASOF, resultOf([]));
    expect(getState().orders).toEqual([]);
    expect(appliedRows().at(0)?.detail).toBe("Applied 0 of your Review corrections to this sync; 2 saved corrections wait for orders not in this ledger");
    expect(listOverrides("user-1")).toHaveLength(2);

    setAccountPipelineResult("acct-a", ASOF, inboxA());
    expect(jacket().total).toBe(60);
    expect(owed()).toBe(60);
  }));

  it("does not apply Gmail corrections to demo data, nor record edits made on demo data", async () => {
    const seed = await loadSeedDemo({ cachePath: "missing-llm-cache.json" });
    await withStoreScope("user-1", async () => {
      setAccountPipelineResult("acct-a", ASOF, inboxA());
      correctJacketPrice();
      const rowsBefore = appliedRows().length;
      setPipelineResult("demo", seed.asOf, seed);
      expect(getState().findings).toHaveLength(14);
      expect(owed()).toBe(1774.23);
      expect(appliedRows()).toHaveLength(rowsBefore);
      expect(getState().orders.some(order => order.review?.correctedFields)).toBe(false);

      const demoOrder = getState().orders.find(order => order.needsReview || order.confMin < 0.7);
      if (demoOrder) editReviewedOrder(demoOrder.id, demoOrder.review!.revision, { field: "total", value: 1 }, at);
      expect(listOverrides("user-1")).toHaveLength(2); // only the Gmail ones
    });
  });

  it("keeps anonymous corrections in memory only: no database file is created", () => {
    setPipelineResult("upload", ASOF, inboxA());
    correctJacketPrice();
    setPipelineResult("upload", ASOF, inboxA());
    expect(jacket().total).toBe(60);
    expect(existsSync(join(dir, "papertrail.sqlite"))).toBe(false);
  });

  it("never creates the database file when reading before anything was written", () => withStoreScope("user-1", () => {
    setAccountPipelineResult("acct-a", ASOF, inboxA());
    expect(owed()).toBe(0);
    expect(existsSync(join(dir, "papertrail.sqlite"))).toBe(false);
  }));
});

describe("applyOverrides", () => {
  const edit = (value: number) => ({ kind: "edit" as const, orderId: ORDER_ID, at: at.toISOString(),
    edit: { field: "total" as const, value } });
  const confirm = { kind: "confirm" as const, orderId: ORDER_ID, confirmedAt: at.toISOString(), at: at.toISOString() };

  it("returns the input untouched when there is nothing to apply", () => {
    const result = inboxA();
    expect(applyOverrides(result, [], { now: NOW })).toEqual({ result, report: { applied: 0, orphaned: 0 } });
  });

  it("recomputes findings from the corrected values and is idempotent", () => {
    const first = applyOverrides(inboxA(), [edit(60), confirm], { now: NOW });
    expect(first.report).toEqual({ applied: 2, orphaned: 0 });
    expect(first.result.findings.map(finding => finding.amountAtStake)).toEqual([60]);
    expect(first.result.stats).toMatchObject({ findings: 1, needsReview: 0 });
    const second = applyOverrides(first.result, [edit(60), confirm], { now: NOW });
    expect(second.report).toEqual({ applied: 0, orphaned: 0 });
    expect(second.result).toBe(first.result);
  });

  it("leaves an edited but unconfirmed order awaiting review with no findings", () => {
    const { result } = applyOverrides(inboxA(), [edit(60)], { now: NOW });
    expect(result.orders[0]).toMatchObject({ needsReview: true, review: { correctedFields: ["total"] } });
    expect(result.findings).toEqual([]);
    expect(result.reviewQueue).toEqual([expect.objectContaining({ orderId: ORDER_ID, stage: "match" })]);
  });

  it("keeps an edit for a line item the fresh extraction no longer has as orphaned and still applies the others", () => {
    const missing = { ...edit(60), edit: { field: "lineItemQty" as const, lineItemId: "gone", value: 2 } };
    const { result, report } = applyOverrides(inboxA(), [missing, { ...edit(60), edit: { field: "total", value: 75 } }, confirm], { now: NOW });
    expect(report).toEqual({ applied: 2, orphaned: 1 });
    expect(result.orders[0].total).toBe(75);
  });

  it("applies resolved and dismissed finding decisions and reports decisions for missing findings", () => {
    const findingId = `refund_overdue:${ORDER_ID}`;
    const { result, report } = applyOverrides(confidentInboxA(), [
      { kind: "finding", findingId, status: "dismissed", at: at.toISOString() },
      { kind: "finding", findingId: "refund_overdue:order:gone", status: "resolved", at: at.toISOString() },
    ], { now: NOW });
    expect(result.findings[0].status).toBe("dismissed");
    expect(report).toEqual({ applied: 1, orphaned: 1 });
  });
});

describe("override store", () => {
  it("round-trips records per scope, replaces by key, and an edit withdraws the confirmation", () => {
    const store = createOverrideStore(":memory:");
    const record = { kind: "edit" as const, orderId: ORDER_ID, emailId: "a-1", at: "2026-10-17T10:00:00.000Z",
      edit: { field: "total" as const, value: 70 } };
    store.put("alice", record);
    store.put("alice", { kind: "confirm", orderId: ORDER_ID, confirmedAt: "2026-10-17T10:05:00.000Z", at: "2026-10-17T10:05:00.000Z" });
    store.put("alice", { kind: "finding", findingId: "f1", status: "dismissed", at: "2026-10-17T10:06:00.000Z" });
    store.put("bob", record);
    expect(store.list("alice").map(entry => entry.kind)).toEqual(["edit", "confirm", "finding"]);

    store.put("alice", { ...record, at: "2026-10-17T11:00:00.000Z", edit: { field: "total", value: 65 } });
    expect(store.list("alice").map(entry => entry.kind)).toEqual(["finding", "edit"]);
    expect(store.list("alice")[1]).toMatchObject({ edit: { field: "total", value: 65 }, emailId: "a-1" });
    store.removeFinding("alice", "f1");
    expect(store.list("alice")).toHaveLength(1);
    expect(store.deleteScope("alice")).toBe(1);
    expect(store.list("bob")).toHaveLength(1);
  });
});
