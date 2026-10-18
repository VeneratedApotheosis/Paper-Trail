import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as start } from "@/app/api/auth/google/route";
import { GET as callback } from "@/app/api/auth/callback/route";
import { GET as session } from "@/app/api/auth/session/route";
import { GET as preview } from "@/app/api/gmail/preview/route";
import { POST as sync } from "@/app/api/gmail/sync/route";
import { GET as progress } from "@/app/api/gmail/sync/status/route";
import { GET as ledger } from "@/app/api/ledger/route";
import { GET as audit } from "@/app/api/audit/route";
import { POST as deleteAll } from "@/app/api/delete-all/route";
import { GMAIL_SCOPE, SESSION_COOKIE, TRANSACTION_COOKIE } from "@/lib/auth/config";
import { createAuthStore, type AuthStore } from "@/lib/auth/store";
import { resetStore } from "@/lib/store";
import { EXTRACTION_TOOL_NAME } from "@/lib/ingestion/extract-prompt";

let db: AuthStore;
vi.mock("@/lib/auth/store", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/auth/store")>();
  return { ...original, authStore: () => db };
});
const origin = "http://localhost:3000";
const now = new Date("2026-10-17T12:00:00Z");
const privateText = "Call (555) 012-3456. Card 4111 1111 1111 1111.";
function req(path: string, cookie?: string, body?: unknown) {
  return new NextRequest(`${origin}/api/${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { origin, ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function message(id: string) {
  const returned = id === "synthetic-return";
  const text = returned ? "Return received for order #SY-1001. Refund of $40.00 will be issued within 10 days."
    : `Thank you for your order #SY-1001. Trail jacket x1 $40.00. Order total: $40.00. ${privateText}`;
  return { id, internalDate: String(Date.parse(returned ? "2026-09-10T10:00:00Z" : "2026-09-01T10:00:00Z")),
    payload: { mimeType: "text/plain", headers: [
      { name: "From", value: "orders@synthetic.example" }, { name: "To", value: "shopper@example.test" },
      { name: "Subject", value: returned ? "Return received #SY-1001" : "Order confirmation #SY-1001" },
    ], body: { data: Buffer.from(text).toString("base64url") } } };
}
function extraction(returned: boolean) {
  return { fields: { merchant: "Synthetic Store", merchantDomain: "synthetic.example", orderRef: "SY-1001",
    date: returned ? "2026-09-10" : "2026-09-01", currency: "USD", totals: { total: 40 },
    lineItems: returned ? [] : [{ name: "Trail jacket", qty: 1, unitPrice: 40 }],
    ...(returned ? { refundSlaDays: 10 } : {}),
  }, confidence: { merchant: 0.95, merchantDomain: 0.95, orderRef: 0.95, date: 0.95, currency: 0.95, totals: 0.95, lineItems: 0.95,
    ...(returned ? { refundSlaDays: 0.95 } : {}),
  },
  evidence: { totals: returned ? "Refund of $40.00" : "Order total: $40.00",
    ...(returned ? { refundSlaDays: "Refund of $40.00 will be issued within 10 days." } : {}),
  } };
}
beforeEach(() => {
  resetStore(); db = createAuthStore(":memory:");
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-secret");
  vi.stubEnv("AUTH_ENCRYPTION_KEY", "ab".repeat(32)); vi.stubEnv("AUTH_BASE_URL", origin);
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-key"); vi.stubEnv("LLM_MODEL", "synthetic-model");
});
afterEach(() => { db.close(); resetStore(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("connects OAuth, previews and syncs through real handlers, preserves a failed sync, then deletes and disconnects", async () => {
  let gmailDenied = false;
  let llmUnavailable = false;
  let mailbox = "shopper@example.test";
  const llmInputs: string[] = [];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token") {
      return Response.json({ access_token: "synthetic-access", refresh_token: "synthetic-refresh",
        expires_in: 3600, token_type: "Bearer", scope: GMAIL_SCOPE });
    }
    if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/revoke") return new Response(null, { status: 200 });
    if (url.hostname === "gmail.googleapis.com") {
      if (url.pathname.endsWith("/profile")) return Response.json({ emailAddress: mailbox });
      if (gmailDenied) return new Response(null, { status: 401 });
      if (url.pathname.endsWith("/messages")) return Response.json({ resultSizeEstimate: 2,
        messages: [{ id: llmUnavailable ? "synthetic-new" : "synthetic-order" }, { id: "synthetic-return" }] });
      const id = url.pathname.split("/").at(-1)!;
      if (id === "synthetic-new") {
        const changed = message(id);
        changed.payload.body.data = Buffer.from("Thank you for your order #SY-1002. Order total: $50.00.").toString("base64url");
        return Response.json(changed);
      }
      if (["synthetic-order", "synthetic-return"].includes(id)) return Response.json(message(id));
    }
    if (url.hostname === "api.anthropic.com") {
      if (llmUnavailable) return Response.json({ error: { type: "overloaded_error" } }, { status: 503 });
      const body = String(init?.body); llmInputs.push(body);
      const prompt = (JSON.parse(body) as { messages: Array<{ content: string }> }).messages[0].content;
      return Response.json({ model: "synthetic-model", usage: { input_tokens: 100, output_tokens: 100 },
        content: [{ type: "tool_use", name: EXTRACTION_TOOL_NAME, input: extraction(prompt.includes("Subject: Return received")) }] });
    }
    throw new Error("Unexpected provider endpoint");
  });
  vi.stubGlobal("fetch", fetcher);
  const authorization = await start();
  const consent = new URL(authorization.headers.get("location")!);
  expect(consent.searchParams.get("scope")).toBe(GMAIL_SCOPE);
  const oauthCookie = authorization.cookies.get(TRANSACTION_COOKIE)!.value;
  const authenticated = await callback(new NextRequest(`${origin}/api/auth/callback?code=synthetic-code&state=${consent.searchParams.get("state")}`, {
    headers: { cookie: `${TRANSACTION_COOKIE}=${oauthCookie}` },
  }));
  expect(authenticated.headers.get("location")).toBe(`${origin}/sync`);
  const cookie = authenticated.cookies.get(SESSION_COOKIE)!.value;
  expect(await (await session(req("auth/session", cookie))).json()).toEqual({ connected: true });
  const callsBeforePreview = fetcher.mock.calls.length;
  expect(await (await preview(req("gmail/preview", cookie))).json()).toMatchObject({ messagesToFetch: 2, maxMessages: 300 });
  expect(fetcher.mock.calls.length).toBe(callsBeforePreview + 1);
  expect(llmInputs).toEqual([]);
  const synced = await sync(req("gmail/sync", cookie, { confirmed: true }));
  expect(synced.status).toBe(200);
  expect(await synced.json()).toMatchObject({ mode: "gmail", fetched: 2 });
  expect(llmInputs).toHaveLength(2);
  expect(llmInputs.join(" ")).not.toContain("4111 1111 1111 1111");
  expect(llmInputs.join(" ")).not.toContain("(555) 012-3456");
  const connectedLedger = await (await ledger(req("ledger", cookie))).json();
  expect(connectedLedger.orders).toHaveLength(1);
  expect(connectedLedger.findings).toContainEqual(expect.objectContaining({ kind: "refund_overdue", amountAtStake: 40 }));
  expect(connectedLedger.summary.owedTotal).toBe(40);
  expect(JSON.stringify(connectedLedger)).not.toContain(privateText);
  expect(JSON.stringify(connectedLedger)).not.toContain("synthetic-access");
  expect((await (await ledger(req("ledger"))).json()).orders).toEqual([]);
  const auditText = await (await audit(req("audit", cookie))).text();
  expect(auditText).toContain("gmail_fetch");
  expect(auditText).toContain("llm_call");
  expect(auditText).not.toContain("synthetic-access");
  expect(auditText).not.toContain(privateText);
  // A second real OAuth callback creates a separate account, not just a
  // fabricated session cookie. Its ledger must not contain the first inbox.
  mailbox = "other-shopper@example.test";
  const otherStart = await start();
  const otherConsent = new URL(otherStart.headers.get("location")!);
  const otherCallback = await callback(new NextRequest(`${origin}/api/auth/callback?code=synthetic-other&state=${otherConsent.searchParams.get("state")}`, {
    headers: { cookie: `${TRANSACTION_COOKIE}=${otherStart.cookies.get(TRANSACTION_COOKIE)!.value}` },
  }));
  const otherCookie = otherCallback.cookies.get(SESSION_COOKIE)!.value;
  expect((await (await ledger(req("ledger", otherCookie))).json()).orders).toEqual([]);
  expect(await (await progress(req("gmail/sync/status", cookie))).json()).toMatchObject({ stage: "complete", fetched: 2, total: 2 });
  llmUnavailable = true;
  const outage = await sync(req("gmail/sync", cookie, { confirmed: true }));
  expect(outage.status).toBe(503);
  expect(await outage.json()).toMatchObject({ code: "extraction_unavailable" });
  expect((await (await ledger(req("ledger", cookie))).json()).findings).toEqual(connectedLedger.findings);
  expect((await (await ledger(req("ledger", cookie))).json()).orders).toEqual(connectedLedger.orders);
  llmUnavailable = false;
  gmailDenied = true;
  expect((await sync(req("gmail/sync", cookie, { confirmed: true }))).status).toBe(401);
  expect((await (await ledger(req("ledger", cookie))).json()).orders).toEqual(connectedLedger.orders);
  expect((await (await ledger(req("ledger", cookie))).json()).findings).toEqual(connectedLedger.findings);
  const deleted = await deleteAll(req("delete-all", cookie, {}));
  expect(deleted.status).toBe(200);
  expect(await deleted.json()).toMatchObject({ deleted: true, revokedToken: true });
  expect((await session(req("auth/session", cookie))).status).toBe(401);
  expect((await ledger(req("ledger", cookie))).status).toBe(401);
  expect((await progress(req("gmail/sync/status", cookie))).status).toBe(401);
  expect(await (await session(req("auth/session", otherCookie))).json()).toEqual({ connected: true });
}, 15000);
