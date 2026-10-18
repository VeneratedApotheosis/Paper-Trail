import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as editRoute } from "@/app/api/review/[id]/edit/route";
import { POST as confirmRoute } from "@/app/api/review/[id]/confirm/route";
import type { OrderFieldEdit } from "@/components/ReviewCard";
import { ApiError } from "@/lib/api/client";
import type { ApiErrorBody } from "@/lib/api/types";
import type { NormalizedOrder } from "@/lib/contracts";
import type { ReviewQueueItem } from "@/lib/pipeline/run";
import { orderNeedsReview } from "@/lib/rules/owed";
import { makeEvent, makeOrder } from "@/lib/rules/test-helpers";
import { getOrder, getState, resetStore, setPipelineResult } from "@/lib/store";
import type { ReviewMutationResponse } from "@/lib/api/types";
import {
  applyEdits,
  bufferEdit,
  itemsWithoutOrder,
  saveEditsThenConfirm,
  type ConfirmReviewSteps,
} from "./reviewFlow";

const REVISION = "00000000-0000-4000-8000-000000000001";
const order = makeOrder({ id: "order:review", confMin: 0.5, needsReview: true, review: { revision: REVISION } });

function response(revision: string, overrides: Partial<ReviewMutationResponse> = {}): ReviewMutationResponse {
  return {
    ok: true,
    order,
    findings: [],
    revision,
    summary: {
      currency: "USD",
      owedTotal: 0,
      findingCount: 0,
      claimSentCount: 0,
      claimSentTotal: 0,
      excludedCount: 0,
      excludedTotal: 0,
    },
    ...overrides,
  };
}

function fakeSteps(overrides: Partial<ConfirmReviewSteps> = {}) {
  let n = 1;
  return {
    edit: vi.fn(async () => response(`rev-edit-${n++}`)),
    confirm: vi.fn(async () => response("rev-confirmed")),
    ...overrides,
  };
}

describe("bufferEdit / applyEdits", () => {
  it("keeps only the latest value per field and line item", () => {
    let pending: OrderFieldEdit[] = [];
    pending = bufferEdit(order, pending, { field: "total", value: 1 });
    pending = bufferEdit(order, pending, { field: "total", value: 12 });
    pending = bufferEdit(order, pending, { field: "lineItemQty", lineItemId: "li-jacket", value: 2 });
    pending = bufferEdit(order, pending, { field: "lineItemQty", lineItemId: "li-socks", value: 3 });
    expect(pending).toEqual([
      { field: "total", value: 12 },
      { field: "lineItemQty", lineItemId: "li-jacket", value: 2 },
      { field: "lineItemQty", lineItemId: "li-socks", value: 3 },
    ]);
    const shown = applyEdits(order, pending);
    expect(shown.total).toBe(12);
    expect(shown.lineItems.map((li) => li.qty)).toEqual([2, 3]);
    expect(order.total).toBe(113);
  });

  it("drops a buffered edit typed back to the stored value", () => {
    const pending = bufferEdit(order, [], { field: "merchantName", value: "Northwind" });
    expect(bufferEdit(order, pending, { field: "merchantName", value: order.merchant.name })).toEqual([]);
  });
});

describe("saveEditsThenConfirm", () => {
  it("sends each edit with the previous response's revision, then confirms with the newest one", async () => {
    const steps = fakeSteps();
    const outcome = await saveEditsThenConfirm(
      order,
      [
        { field: "total", value: 40 },
        { field: "orderRef", value: "NW-2" },
      ],
      steps,
    );
    expect(vi.mocked(steps.edit).mock.calls).toEqual([
      [order.id, REVISION, { field: "total", value: 40 }],
      [order.id, "rev-edit-1", { field: "orderRef", value: "NW-2" }],
    ]);
    expect(steps.confirm).toHaveBeenCalledWith(order.id, "rev-edit-2");
    expect(outcome).toMatchObject({ status: "confirmed", response: { revision: "rev-confirmed" } });
  });

  it("confirms directly with the stored revision when nothing was edited", async () => {
    const steps = fakeSteps();
    await saveEditsThenConfirm(order, [], steps);
    expect(steps.edit).not.toHaveBeenCalled();
    expect(steps.confirm).toHaveBeenCalledWith(order.id, REVISION);
  });

  it("sends nothing when a buffered edit fails the review schema", async () => {
    const steps = fakeSteps();
    const outcome = await saveEditsThenConfirm(
      order,
      [
        { field: "total", value: 40 },
        { field: "merchantName", value: "  " },
      ],
      steps,
    );
    expect(outcome).toEqual({ status: "invalid_edit", message: "Merchant needs 1 to 200 characters." });
    expect(steps.edit).not.toHaveBeenCalled();
    expect(steps.confirm).not.toHaveBeenCalled();
  });

  it("reports a 409 as stale and stops", async () => {
    const steps = fakeSteps({
      edit: vi.fn(async () => {
        throw new ApiError(409, { error: "Order changed; reload the review before continuing." });
      }),
    });
    const outcome = await saveEditsThenConfirm(order, [{ field: "total", value: 40 }], steps);
    expect(outcome).toEqual({
      status: "stale",
      savedEdits: 0,
      message: "Order changed; reload the review before continuing.",
    });
    expect(steps.confirm).not.toHaveBeenCalled();
  });

  it("reports how many edits were saved before a failure and never confirms", async () => {
    const steps = fakeSteps({
      edit: vi
        .fn()
        .mockResolvedValueOnce(response("rev-edit-1"))
        .mockRejectedValueOnce(new ApiError(422, { error: "Corrected order is invalid; check quantities and amounts." })),
    });
    const outcome = await saveEditsThenConfirm(
      order,
      [
        { field: "total", value: 40 },
        { field: "lineItemQty", lineItemId: "li-jacket", value: 2 },
      ],
      steps,
    );
    expect(outcome).toEqual({
      status: "failed",
      savedEdits: 1,
      message: "Corrected order is invalid; check quantities and amounts.",
    });
    expect(steps.confirm).not.toHaveBeenCalled();
  });

  it("treats a network error as a failure with nothing confirmed", async () => {
    const steps = fakeSteps({ confirm: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) });
    expect(await saveEditsThenConfirm(order, [], steps)).toEqual({
      status: "failed",
      savedEdits: 0,
      message: "The app server could not be reached.",
    });
  });

  it("treats an order without a revision as stale", async () => {
    const steps = fakeSteps();
    const outcome = await saveEditsThenConfirm({ ...order, review: undefined }, [], steps);
    expect(outcome.status).toBe("stale");
    expect(steps.confirm).not.toHaveBeenCalled();
  });
});

describe("itemsWithoutOrder", () => {
  it("keeps orderless items unless their email belongs to an order already in the queue", () => {
    const items: ReviewQueueItem[] = [
      { emailId: "msg-order", stage: "extract", reason: "low confidence" },
      { emailId: "msg-other", stage: "extract", reason: "extraction failed" },
      { emailId: "msg-promo", stage: "classify", reason: "uncertain class" },
      { emailId: "msg-order", stage: "match", reason: "needs review", orderId: order.id },
    ];
    expect(itemsWithoutOrder(items, [order]).map((item) => item.emailId)).toEqual(["msg-other", "msg-promo"]);
  });
});

// The same flow against the real review route handlers (#47) and the in-memory store (anonymous scope).
describe("saveEditsThenConfirm against the review routes", () => {
  type Route = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;

  function routeStep(route: Route) {
    return async (id: string, body: unknown): Promise<ReviewMutationResponse> => {
      const response = await route(
        new Request(`http://localhost:3000/api/review/${encodeURIComponent(id)}`, {
          method: "POST",
          headers: { origin: "http://localhost:3000", "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: encodeURIComponent(id) }) },
      );
      const json: unknown = await response.json();
      if (!response.ok) throw new ApiError(response.status, json as ApiErrorBody);
      return json as ReviewMutationResponse;
    };
  }

  const steps: ConfirmReviewSteps = {
    edit: (id, revision, edit) => routeStep(editRoute)(id, { revision, edit }),
    confirm: (id, revision) => routeStep(confirmRoute)(id, { revision, confirmed: true }),
  };

  function loadReviewOrder(): NormalizedOrder {
    const stored = makeOrder({
      id: "review:synthetic",
      confMin: 0.45,
      needsReview: true,
      events: [makeEvent("return_received", "2026-09-01T12:00:00Z", { evidence: "Synthetic warehouse received the return" })],
    });
    setPipelineResult("upload", new Date().toISOString(), {
      orders: [stored],
      findings: [],
      reviewQueue: [{ orderId: stored.id, emailId: "msg-order", stage: "match", reason: "low confidence" }],
      stats: {
        emails: 1,
        prefilteredOut: 0,
        classes: { order: 1 },
        extracted: 1,
        skipped: 0,
        extractionOrigins: { llm: 1, cache: 0, gold: 0 },
        orders: 1,
        excludedOrders: 0,
        findings: 0,
        needsReview: 1,
      },
    });
    return getOrder(stored.id)!;
  }

  beforeEach(() => resetStore());
  afterEach(() => resetStore());

  it("saves buffered edits with rotating revisions, confirms, and the order leaves the queue", async () => {
    const stored = loadReviewOrder();
    let pending = bufferEdit(stored, [], { field: "total", value: 39 });
    pending = bufferEdit(stored, pending, { field: "total", value: 40 });
    pending = bufferEdit(stored, pending, { field: "lineItemName", lineItemId: "li-jacket", value: "Rain Shell" });

    const outcome = await saveEditsThenConfirm(stored, pending, steps);

    expect(outcome.status).toBe("confirmed");
    const saved = getOrder(stored.id)!;
    expect(saved.total).toBe(40);
    expect(saved.lineItems[0].name).toBe("Rain Shell");
    expect(saved.review?.confirmedAt).toBeTruthy();
    expect(orderNeedsReview(saved)).toBe(false);
    expect(getState().reviewQueue).toEqual([]);
    // Two saved edits (latest value per field) and one confirmation.
    expect(getState().audit.map((entry) => entry.detail.split(":")[0])).toEqual([
      "Review confirmed",
      "Review edit saved",
      "Review edit saved",
    ]);
    if (outcome.status === "confirmed") expect(outcome.response.summary.owedTotal).toBe(40);
  });

  it("reports stale when the order changed after the page loaded", async () => {
    const loaded = loadReviewOrder();
    await steps.edit(loaded.id, loaded.review!.revision, { field: "orderRef", value: "NW-OTHER-TAB" });

    const outcome = await saveEditsThenConfirm(loaded, [{ field: "total", value: 40 }], steps);

    expect(outcome).toMatchObject({ status: "stale", savedEdits: 0 });
    expect(getOrder(loaded.id)!.total).toBe(113);
    expect(orderNeedsReview(getOrder(loaded.id)!)).toBe(true);
  });
});
