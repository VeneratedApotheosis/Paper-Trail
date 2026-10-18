import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST as sync } from "@/app/api/gmail/sync/route";
import { GET as status } from "@/app/api/gmail/sync/status/route";
import { GET as ledger } from "@/app/api/ledger/route";
import { GET as audit } from "@/app/api/audit/route";
import { authConfig, SESSION_COOKIE } from "@/lib/auth/config";
import { createAuthStore, type AuthStore } from "@/lib/auth/store";
import { seal } from "@/lib/auth/crypto";
import { EXTRACTION_TOOL_NAME } from "@/lib/ingestion/extract-prompt";
import { clearLedger, getState, resetStore, withStoreScope } from "@/lib/store";

let db: AuthStore;
vi.mock("@/lib/auth/store", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/auth/store")>();
  return { ...original, authStore: () => db };
});
function account() {
  const key = authConfig().key;
  const id = db.save("one@example.test", seal({ accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: Date.now() + 3600000 }, key, "tokens"));
  return { id, cookie: seal({ userId: id, expiresAt: Date.now() + 3600000 }, key, "session") };
}
function req(path: string, cookie: string, body?: unknown) {
  return new Request(`http://localhost:3000/api/${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { origin: "http://localhost:3000", cookie: `${SESSION_COOKIE}=${cookie}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const ids = Array.from({ length: 8 }, (_, i) => `m${i}`);
function message(id: string, revision: string) {
  return { id, internalDate: String(Date.parse("2026-09-01T10:00:00Z")), payload: { mimeType: "text/plain", headers: [
    { name: "From", value: "orders@synthetic.example" }, { name: "Subject", value: `Order confirmation #${id}` },
  ], body: { data: Buffer.from(`Thank you for your order #${id}. Order total: $40.00. ${revision}`).toString("base64url") } } };
}
function toolResponse(prompt: string) {
  const orderRef = /order #(m\d+)/.exec(prompt)?.[1] ?? "m0";
  return Response.json({ model: "synthetic-model", usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: "tool_use",
    name: EXTRACTION_TOOL_NAME, input: {
      fields: { merchant: "Synthetic Store", merchantDomain: "synthetic.example", orderRef, date: "2026-09-01", currency: "USD",
        totals: { total: 40 }, lineItems: [{ name: "Trail jacket", qty: 1, unitPrice: 40 }] },
      confidence: { merchant: 0.95, merchantDomain: 0.95, orderRef: 0.95, date: 0.95, currency: 0.95, totals: 0.95, lineItems: 0.95 },
      evidence: { totals: "Order total: $40.00" } } }] });
}
/** Fake Gmail + Anthropic over global fetch; `onLlmCall` runs inside the first call (e.g. to delete data mid-sync). */
function stubProviders(onFirstLlmCall?: () => void, revision = "first edition") {
  const state = { inFlight: 0, maxInFlight: 0, llmCalls: 0 };
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "gmail.googleapis.com") {
      return url.pathname.endsWith("/messages") ? Response.json({ messages: ids.map(id => ({ id })) })
        : Response.json(message(url.pathname.split("/").at(-1)!, revision));
    }
    if (url.hostname === "api.anthropic.com") {
      state.llmCalls += 1; state.inFlight += 1; state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      if (state.llmCalls === 1) onFirstLlmCall?.();
      try {
        await new Promise(resolve => setTimeout(resolve, 30));
        return toolResponse((JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }).messages[0].content);
      } finally { state.inFlight -= 1; }
    }
    throw new Error("Unexpected provider endpoint");
  }));
  return state;
}
beforeEach(() => {
  db = createAuthStore(":memory:"); resetStore();
  vi.stubEnv("AUTH_ENCRYPTION_KEY", "ab".repeat(32)); vi.stubEnv("AUTH_BASE_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-secret");
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-key"); vi.stubEnv("LLM_MODEL", "synthetic-model");
  vi.stubEnv("PROMO_FETCH_LIMIT", "0"); // these tests are about receipts; promotions are covered in promotions-fetch.test.ts
});
afterEach(() => { db.close(); resetStore(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("publishes the complete ledger once, with every call audited, when fetching and 4-way extraction overlap", async () => {
  const llm = stubProviders();
  const { cookie } = account();
  const response = await sync(req("gmail/sync", cookie, { confirmed: true }));
  expect(response.status).toBe(200);
  expect(llm.llmCalls).toBe(8);
  expect(llm.maxInFlight).toBeGreaterThan(1);
  expect(llm.maxInFlight).toBeLessThanOrEqual(4);
  expect((await (await ledger(req("ledger", cookie))).json()).orders).toHaveLength(8);
  expect(await (await status(req("gmail/sync/status", cookie))).json()).toEqual({ stage: "complete", fetched: 8, total: 8, skipped: 0 });
  const auditText = await (await audit(req("audit", cookie))).text();
  expect(auditText.match(/llm_call/g)).toHaveLength(8);
  expect(auditText.match(/gmail_fetch/g)).toHaveLength(9);
});

it("publishes nothing when the user deletes their data while extraction is running (#93 generation guard)", async () => {
  const { id, cookie } = account();
  const llm = stubProviders(() => withStoreScope(id, clearLedger));
  const response = await sync(req("gmail/sync", cookie, { confirmed: true }));
  expect(response.status).toBe(409);
  expect(llm.llmCalls).toBe(8);
  expect(withStoreScope(id, getState).orders).toEqual([]);
  expect(withStoreScope(id, getState).findings).toEqual([]);
  expect(withStoreScope(id, getState).stats).toBeNull();
  expect(await (await status(req("gmail/sync/status", cookie))).json()).toMatchObject({ stage: "failed" });
});

it("keeps the previous ledger when the sync is canceled mid-way", async () => {
  const { id, cookie } = account();
  stubProviders();
  expect((await sync(req("gmail/sync", cookie, { confirmed: true }))).status).toBe(200);
  const before = withStoreScope(id, getState).orders;
  expect(before).toHaveLength(8);
  const abort = new AbortController();
  const llm = stubProviders(() => abort.abort(), "second edition"); // new text, so the extraction cache cannot answer
  const canceled = await sync(new Request(req("gmail/sync", cookie, { confirmed: true }), { signal: abort.signal }));
  expect(canceled.status).toBe(503);
  expect(llm.llmCalls).toBeLessThan(8);
  expect(withStoreScope(id, getState).orders).toEqual(before);
  expect(await (await status(req("gmail/sync/status", cookie))).json()).toMatchObject({ stage: "failed" });
});
