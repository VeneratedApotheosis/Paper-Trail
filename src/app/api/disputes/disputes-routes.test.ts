import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getState, resetStore, setPipelineResult, withStoreScope, excludeMerchant } from "@/lib/store";
import { makeOrder } from "@/lib/rules/test-helpers";
import { POST } from "./[orderId]/route";

// Synthetic identity resolver; exercise the actual scope wrapper, without Google or credentials.
vi.mock("@/lib/auth/session", () => ({
  sessionCookie: (request: Request) => request.headers.get("x-test-user") ?? undefined,
  resolveSessionUser: (request: Request) => request.headers.get("x-test-user"),
  clearAuthCookies: (response: Response) => response,
}));
const order = makeOrder({ id: "order:synthetic-dispute" });
const valid = { reason: "item_not_received", confirmed: true };
const context = (id = order.id) => ({ params: Promise.resolve({ orderId: encodeURIComponent(id) }) });
function request(body: unknown = valid, user?: string) {
  return new Request("http://localhost:3320/api/disputes/order", { method: "POST",
    headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) }, body: JSON.stringify(body) });
}
function install(candidate: typeof order) {
  setPipelineResult("demo", "2026-10-17T19:00:00Z", { orders: [candidate], findings: [], reviewQueue: [],
    stats: { emails: 0, prefilteredOut: 0, classes: {}, skipped: 0, extracted: 0,
      extractionOrigins: { llm: 0, cache: 0, gold: 0 }, orders: 1, excludedOrders: 0, findings: 0, needsReview: 0 } });
}
beforeEach(() => { resetStore(); install(order); });
afterEach(() => { resetStore(); for (const user of ["synthetic-a", "synthetic-b"]) withStoreScope(user, resetStore); });

it("returns a draft without mutating owed findings, stored drafts, or audit", async () => {
  const before = getState();
  const response = await POST(request(), context());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const result = await response.json();
  expect(result.draft.orderId).toBe(order.id);
  expect(result.draft.requiresApproval).toBe(true);
  expect(result.draft).not.toHaveProperty("mailtoUrl");
  expect(getState()).toEqual(before);
});
it("validates wrong-item details and known line item", async () => {
  const details = { reason: "wrong_item", confirmed: true, lineItemId: order.lineItems[0].id, receivedItem: "Synthetic mug" };
  expect((await POST(request(details), context())).status).toBe(200);
  expect((await POST(request({ ...details, lineItemId: "foreign-item" }), context())).status).toBe(422);
  expect((await POST(request({ ...details, receivedItem: " " }), context())).status).toBe(400);
});
it("rejects malformed/unconfirmed bodies and unknown/excluded orders", async () => {
  const malformed = new Request("http://localhost:3320/api/disputes/order", { method: "POST", body: "{" });
  expect((await POST(malformed, context())).status).toBe(400);
  expect((await POST(request({ reason: "item_not_received", confirmed: false }), context())).status).toBe(400);
  expect((await POST(request(), context("missing"))).status).toBe(404);
  expect((await POST(request(), context(""))).status).toBe(400);
  excludeMerchant(order.merchant.name);
  expect((await POST(request(), context())).status).toBe(404);
});
it("reads only the request's account even when order ids overlap", async () => {
  withStoreScope("synthetic-a", () => {
    resetStore();
    install({ ...order, merchant: { ...order.merchant, name: "Account A Store" } });
  });
  const own = await POST(request(valid, "synthetic-a"), context());
  expect(await own.text()).toContain("Account A Store");
  expect((await POST(request(valid, "synthetic-b"), context())).status).toBe(404);
  const anonymous = await POST(request(), context());
  expect(await anonymous.text()).not.toContain("Account A Store");
});
