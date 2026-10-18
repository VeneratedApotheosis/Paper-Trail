import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  approveClaim,
  disconnectGmail,
  getAccount,
  getClaim,
  getFinding,
  getOrder,
  getSessionStatus,
  regenerateClaim,
  safeDecode,
  saveClaim,
  setFindingStatus,
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
