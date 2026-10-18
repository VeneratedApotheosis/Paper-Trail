import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  approveClaim,
  disconnectGmail,
  getAccount,
  getClaim,
  getFinding,
  getGmailPreview,
  getGmailSyncStatus,
  getOrder,
  getPromotions,
  getSessionStatus,
  markSkippedAsPromotion,
  markSkippedAsReceipt,
  markEmailNotAboutOrder,
  markNotPurchase,
  regenerateClaim,
  restoreOrder,
  safeDecode,
  saveClaim,
  setFindingStatus,
  syncGmail,
  toGmailFailure,
} from "./client";
import { encodeIdSegment } from "./ids";

const ORDER_ID = "order:northwind.example:NW-48213";
const FINDING_ID = `refund_overdue:${ORDER_ID}`;
const ENCODED_FINDING_ID = encodeURIComponent(FINDING_ID);

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => Response.json({}));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const requestedPaths = () => fetchMock.mock.calls.map(([path]) => path);

describe("safeDecode / encodeIdSegment", () => {
  it("decodes an encoded id once and leaves raw ids unchanged", () => {
    expect(safeDecode(encodeURIComponent(ORDER_ID))).toBe(ORDER_ID);
    expect(safeDecode(ORDER_ID)).toBe(ORDER_ID);
  });

  it("returns malformed percent-encoding unchanged instead of throwing", () => {
    expect(safeDecode("%E0%A4%A")).toBe("%E0%A4%A");
  });

  it("encodes raw and already-encoded ids to the same single-encoded segment", () => {
    expect(encodeIdSegment(ORDER_ID)).toBe("order%3Anorthwind.example%3ANW-48213");
    expect(encodeIdSegment(encodeURIComponent(ORDER_ID))).toBe("order%3Anorthwind.example%3ANW-48213");
  });
});

describe("client id path params", () => {
  it("never double-encodes ids that are already percent-encoded (Next 15 params.id)", async () => {
    await getOrder(encodeURIComponent(ORDER_ID));
    await getOrder(ORDER_ID);
    await getFinding(ENCODED_FINDING_ID);
    await setFindingStatus(ENCODED_FINDING_ID, "resolved");
    await getClaim(ENCODED_FINDING_ID);
    await regenerateClaim(ENCODED_FINDING_ID);
    await saveClaim(ENCODED_FINDING_ID, { subject: "s", body: "b", recipient: "" });
    await approveClaim(FINDING_ID);

    const finding = encodeURIComponent(FINDING_ID);
    expect(requestedPaths()).toEqual([
      `/api/orders/${encodeURIComponent(ORDER_ID)}`,
      `/api/orders/${encodeURIComponent(ORDER_ID)}`,
      `/api/findings/${finding}`,
      `/api/findings/${finding}/status`,
      `/api/claims/${finding}`,
      `/api/claims/${finding}`,
      `/api/claims/${finding}`,
      `/api/claims/${finding}/approve`,
    ]);
    expect(requestedPaths().some((path) => String(path).includes("%25"))).toBe(false);
  });
});

describe("getSessionStatus", () => {
  it("returns the disconnected body of a 401 instead of throwing", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ connected: false, reconnectUrl: "/api/auth/google" }, { status: 401 }));
    expect(await getSessionStatus()).toEqual({ connected: false, reconnectUrl: "/api/auth/google" });
    expect(requestedPaths()).toEqual(["/api/auth/session"]);
  });

  it("treats a non-JSON response as disconnected", async () => {
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 500 }));
    expect(await getSessionStatus()).toEqual({ connected: false });
  });
});

describe("account client", () => {
  it("reads /api/account and posts /api/auth/disconnect", async () => {
    await getAccount();
    await disconnectGmail();
    expect(requestedPaths()).toEqual(["/api/account", "/api/auth/disconnect"]);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });
  });
});

describe("Gmail client", () => {
  it("reads the preview and the sync status, and posts the confirmed sync", async () => {
    await getGmailPreview();
    await getGmailSyncStatus();
    await syncGmail();
    expect(requestedPaths()).toEqual(["/api/gmail/preview", "/api/gmail/sync/status", "/api/gmail/sync"]);
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "POST", body: JSON.stringify({ confirmed: true }) });
  });

  it("throws an ApiError that keeps the route's status and code", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "Gmail sync did not complete. Try again.", code: "sync_timeout" }, { status: 504 }),
    );
    const failure = await syncGmail().catch((caught: unknown) => toGmailFailure(caught));
    expect(failure).toEqual({ status: 504, code: "sync_timeout", error: "Gmail sync did not complete. Try again." });
  });

  it("maps a network failure or an unreadable body to status 0 / null fields", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await getGmailPreview().catch((caught: unknown) => toGmailFailure(caught))).toEqual({
      status: 0,
      code: null,
      error: null,
    });
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 502 }));
    expect(await getGmailPreview().catch((caught: unknown) => toGmailFailure(caught))).toEqual({
      status: 502,
      code: null,
      error: null,
    });
  });
});
describe("promotions and skipped-email feedback (#131)", () => {
  it("reads the promotions, with expired ones only on request", async () => {
    await getPromotions();
    await getPromotions({ includeExpired: true });
    expect(requestedPaths()).toEqual(["/api/promotions", "/api/promotions?include=expired"]);
  });

  it("posts 'this is a promotion' and 'this is a shipping update' to the right routes", async () => {
    await markSkippedAsPromotion("<m1@mail.example>");
    await markSkippedAsReceipt("<m1@mail.example>", { class: "shipped" });
    expect(requestedPaths()).toEqual([
      `/api/quality/skipped/${encodeURIComponent("<m1@mail.example>")}/promotion`,
      `/api/quality/skipped/${encodeURIComponent("<m1@mail.example>")}/receipt`,
    ]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ class: "shipped" });
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });
});

describe("not a purchase client (#134)", () => {
  it("posts the three order feedback routes with single-encoded ids", async () => {
    await markNotPurchase(encodeURIComponent(ORDER_ID));
    await restoreOrder(ORDER_ID);
    await markEmailNotAboutOrder(ORDER_ID, "<msg:1@edge.example>");
    const order = encodeURIComponent(ORDER_ID);
    expect(requestedPaths()).toEqual([
      `/api/orders/${order}/not-purchase`,
      `/api/orders/${order}/restore`,
      `/api/orders/${order}/emails/${encodeURIComponent("<msg:1@edge.example>")}/not-about-order`,
    ]);
    expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit).method === "POST")).toBe(true);
  });

  it("throws the route's message on a refusal", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Order not found" }, { status: 404 }));
    await expect(markNotPurchase("x")).rejects.toMatchObject({ status: 404, message: "Order not found" });
  });
});
