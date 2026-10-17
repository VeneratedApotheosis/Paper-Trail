import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { GET } from "@/app/api/review/route";
import { POST as edit } from "@/app/api/review/[id]/edit/route";
import { POST as confirm } from "@/app/api/review/[id]/confirm/route";
import { createAuthStore, type AuthStore } from "@/lib/auth/store";
import { seal } from "@/lib/auth/crypto";
import { SESSION_COOKIE } from "@/lib/auth/config";
import { makeOrder, makeEvent } from "@/lib/rules/test-helpers";
import { getOrder, getState, resetStore, setPipelineResult, withStoreScope, excludeMerchant } from "@/lib/store";

let db: AuthStore;
vi.mock("@/lib/auth/store", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/auth/store")>();
  return { ...original, authStore: () => db };
});
function load() {
  const order = makeOrder({ id: "review:synthetic", confMin: 0.45, needsReview: true,
    events: [makeEvent("return_received", "2026-09-01T12:00:00Z", { evidence: "Synthetic warehouse received the return" })] });
  setPipelineResult("upload", new Date().toISOString(), { orders: [order], findings: [],
    reviewQueue: [{ orderId: order.id, emailId: "msg-order", stage: "match", reason: "low confidence" }],
    stats: { emails: 1, prefilteredOut: 0, classes: { order: 1 }, extracted: 1, skipped: 0,
      extractionOrigins: { llm: 1, cache: 0, gold: 0 }, orders: 1, excludedOrders: 0, findings: 0, needsReview: 1 } });
  return getOrder(order.id)!;
}
function request(body?: unknown, cookie?: string) {
  return new Request("http://localhost:3000/api/review", {
    method: body === undefined ? "GET" : "POST",
    headers: { origin: "http://localhost:3000", ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id: encodeURIComponent(id) }) });
function account(mailbox: string) {
  const key = "ab".repeat(32);
  const id = db.save(mailbox, seal({ accessToken: "synthetic", refreshToken: "synthetic-refresh", expiresAt: Date.now() + 3600000 }, key, "tokens"));
  const cookie = seal({ userId: id, expiresAt: Date.now() + 3600000 }, key, "session");
  return { id, cookie };
}
beforeEach(() => {
  db = createAuthStore(":memory:"); resetStore();
  vi.stubEnv("AUTH_ENCRYPTION_KEY", "ab".repeat(32)); vi.stubEnv("AUTH_BASE_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-secret");
});
afterEach(() => { db.close(); resetStore(); vi.unstubAllEnvs(); });

it("lists review orders, saves an edit, and confirms without altering confidence", async () => {
  const order = load();
  const queue = await GET(request());
  expect(queue.headers.get("cache-control")).toBe("no-store");
  expect((await queue.json()).orders[0].id).toBe(order.id);
  const response = await edit(request({ revision: order.review!.revision, edit: { field: "total", value: 40 } }), params(order.id));
  expect(response.status).toBe(200);
  const saved = await response.json();
  expect(saved.order.total).toBe(40); expect(saved.summary.owedTotal).toBe(0);
  const done = await confirm(request({ revision: saved.revision, confirmed: true }), params(order.id));
  const result = await done.json();
  expect(done.status).toBe(200);
  expect(result.order.confMin).toBe(0.45);
  expect(result.order.review.confirmedAt).toBeTruthy();
  expect(result.summary.owedTotal).toBe(40);
  expect((await (await GET(request())).json()).orders).toEqual([]);
});
it("requires explicit confirmation and the current opaque revision", async () => {
  const order = load();
  expect((await confirm(request({ revision: order.review!.revision }), params(order.id))).status).toBe(400);
  expect((await confirm(request({ revision: order.review!.revision, confirmed: false }), params(order.id))).status).toBe(400);
  expect((await confirm(request({ revision: randomUUID(), confirmed: true }), params(order.id))).status).toBe(409);
  expect(getState().audit).toEqual([]);
});
it("rejects invalid edits and forged confidence/review fields without changing state", async () => {
  const order = load(), before = structuredClone(getState());
  for (const change of [
    { field: "total", value: -1 }, { field: "total", value: 1.234 },
    { field: "lineItemQty", lineItemId: "li-jacket", value: 0 },
    { field: "confMin", value: 1 }, { field: "review", value: { confirmedAt: new Date().toISOString() } },
  ]) {
    expect((await edit(request({ revision: order.review!.revision, edit: change }), params(order.id))).status).toBe(400);
  }
  expect(getState()).toEqual(before);
});
it("does not expose another account's order or mutate its queue", async () => {
  const first = account("first@example.test"), second = account("second@example.test");
  const order = withStoreScope(first.id, load);
  expect((await (await GET(request(undefined, second.cookie))).json()).orders).toEqual([]);
  expect((await confirm(request({ revision: order.review!.revision, confirmed: true }, second.cookie), params(order.id))).status).toBe(404);
  expect(withStoreScope(first.id, () => getOrder(order.id)?.needsReview)).toBe(true);
  expect((await confirm(request({ revision: order.review!.revision, confirmed: true }, first.cookie), params(order.id))).status).toBe(200);
});
it("keeps confirmed account data separate from anonymous demo state", async () => {
  load();
  const first = account("first@example.test");
  const order = withStoreScope(first.id, load);
  await confirm(request({ revision: order.review!.revision, confirmed: true }, first.cookie), params(order.id));
  expect((await (await GET(request())).json()).orders).toHaveLength(1);
});
it("rejects cross-origin, invalid-session, unknown-order and excluded-order requests", async () => {
  const order = load();
  const cross = request({ revision: order.review!.revision, confirmed: true }); cross.headers.set("origin", "https://untrusted.example.test");
  expect((await confirm(cross, params(order.id))).status).toBe(403);
  expect((await GET(request(undefined, "tampered"))).status).toBe(401);
  expect((await confirm(request({ revision: randomUUID(), confirmed: true }), params("unknown"))).status).toBe(404);
  excludeMerchant(order.merchant.name);
  expect((await confirm(request({ revision: order.review!.revision, confirmed: true }), params(order.id))).status).toBe(404);
});
it("rejects malformed JSON safely", async () => {
  const order = load();
  const bad = new Request("http://localhost:3000/api/review", { method: "POST", body: "{" });
  expect((await edit(bad, params(order.id))).status).toBe(400);
  expect(getState().audit).toEqual([]);
});
