import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as deleteAll } from "@/app/api/delete-all/route";
import { POST as sync } from "@/app/api/gmail/sync/route";
import { GET as ledger } from "@/app/api/ledger/route";
import { POST as upload } from "@/app/api/upload/route";
import { POST as demo } from "@/app/api/demo/route";
import { authConfig, SESSION_COOKIE } from "@/lib/auth/config";
import { seal } from "@/lib/auth/crypto";
import { createAuthStore, type AuthStore } from "@/lib/auth/store";
import { EXTRACTION_TOOL_NAME } from "@/lib/ingestion/extract-prompt";
import { createLabelStore, setLabelStore, type LabelStore } from "@/lib/quality/labels";
import { resetStore } from "@/lib/store";
import { GET as quality } from "./route";
import { GET as qualityEval } from "./eval/route";
import { POST as experiment } from "./experiment/route";
import { GET as skipped } from "./skipped/route";
import { POST as markNotReceipt } from "./skipped/[emailId]/not-receipt/route";
import { POST as markReceipt } from "./skipped/[emailId]/receipt/route";

let db: AuthStore;
let labels: LabelStore;
vi.mock("@/lib/auth/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth/store")>();
  return { ...original, authStore: () => db };
});

const ORDER_EML = `From: "Northwind Outfitters" <orders@northwind.example>
To: Sam Rivera <sam.rivera@mail.example>
Subject: Order confirmation #NW-2041
Date: Thu, 01 Oct 2026 10:00:00 +0000
Message-ID: <order-1@edge.example>
Content-Type: text/plain; charset=utf-8

Thanks for your order! Order #NW-2041
Trail Rain Shell 1 $120.00
Order total: $120.00
Paid with Visa ending in 4242. Call 555-012-3456.
`;
const NEWSLETTER_EML = `From: "The Oakhaven Journal" <journal@oakhaven.example>
To: Sam Rivera <sam.rivera@mail.example>
Subject: Five ways to layer textures this autumn
Date: Sat, 10 Oct 2026 09:00:00 +0000
Message-ID: <news-1@edge.example>
Content-Type: text/plain; charset=utf-8

This month in the Journal: five ways to layer textures. Unsubscribe any time.
`;

let anthropicCalls: Array<{ model: string; system: string }>;
function extractionBody(model: string, ref: string, total: number) {
  return { model, usage: { input_tokens: 120, output_tokens: 60 }, content: [{ type: "tool_use", name: EXTRACTION_TOOL_NAME, input: {
    fields: { merchant: "Northwind Outfitters", merchantDomain: "northwind.example", orderRef: ref, date: "2026-10-01", currency: "USD",
      totals: { total }, lineItems: [{ name: "Trail Rain Shell", qty: 1, unitPrice: total }] },
    confidence: { merchant: 0.95, merchantDomain: 0.95, orderRef: 0.95, date: 0.95, currency: 0.95, totals: 0.95, lineItems: 0.95 },
    evidence: { totals: `Order total: $${total}.00` } } }] };
}
function stubAnthropic() {
  anthropicCalls = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== "api.anthropic.com") throw new Error(`Unexpected endpoint ${url.hostname}`);
    const body = JSON.parse(String(init?.body)) as { model: string; system: string; messages: Array<{ content: string }> };
    anthropicCalls.push({ model: body.model, system: body.system });
    const ref = /#([A-Z0-9-]+)/.exec(body.messages[0].content)?.[1] ?? "NW-9";
    return Response.json(extractionBody(body.model, ref, 120));
  }));
}
function uploadRequest(files: Array<{ name: string; content: string }>) {
  const form = new FormData();
  for (const file of files) form.append("files", new File([file.content], file.name));
  return new Request("http://localhost/api/upload", { method: "POST", body: form });
}
const get = (path: string) => new Request(`http://localhost/api/${path}`);
const post = (path: string, body?: unknown) => new Request(`http://localhost/api/${path}`, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const params = (emailId: string) => ({ params: Promise.resolve({ emailId }) });
const json = async <T,>(response: Response) => (await response.json()) as T;

beforeEach(() => {
  db = createAuthStore(":memory:"); resetStore(); labels = createLabelStore(":memory:"); setLabelStore(labels);
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-key"); vi.stubEnv("LLM_MODEL", "claude-haiku-5-5");
  stubAnthropic();
});
afterEach(() => { db.close(); setLabelStore(undefined); resetStore(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("quality routes after an upload", () => {
  it("serves the report, the skipped list, feedback, eval and delete-all clears it all", async () => {
    const uploaded = await upload(uploadRequest([{ name: "order.eml", content: ORDER_EML }, { name: "news.eml", content: NEWSLETTER_EML }]));
    expect(uploaded.status).toBe(200);

    const report = await quality(get("quality"));
    expect(report.headers.get("cache-control")).toBe("no-store");
    const { latest, history } = await json<{ latest: Record<string, unknown>; history: unknown[] }>(report);
    expect(history).toHaveLength(1);
    expect(latest).toMatchObject({ source: "upload", fetched: 2, prefilteredOut: 1, extracted: 1, matchedOrders: 1, llmCalls: 1, inputTokens: 120, outputTokens: 60, bodySource: { plain: 2, html: 0 } });

    const list = await json<{ skipped: Array<Record<string, unknown>>; total: number }>(await skipped(get("quality/skipped")));
    expect(list.total).toBe(1);
    expect(list.skipped[0]).toMatchObject({ emailId: "news-1@edge.example", reason: "prefilter", from: { name: "The Oakhaven Journal", domain: "oakhaven.example" }, subject: "Five ways to layer textures this autumn" });
    expect(JSON.stringify(list)).not.toContain("Unsubscribe");

    const receipt = await markReceipt(post("quality/skipped/x/receipt", { class: "order" }), params("news-1@edge.example"));
    expect(receipt.status).toBe(200);
    expect(await json(receipt)).toMatchObject({ extracted: true, labeled: true, class: "order", summary: { findingCount: expect.any(Number) } });
    expect((await json<{ orders: unknown[] }>(await ledger(get("ledger")))).orders).toHaveLength(2);
    expect((await json<{ total: number }>(await skipped(get("quality/skipped")))).total).toBe(0);
    expect(labels.list("anonymous").map((label) => label.emailId)).toEqual(["news-1@edge.example"]);

    const notReceipt = await markNotReceipt(post("x"), params("order-1@edge.example"));
    expect(await json(notReceipt)).toMatchObject({ removedOrders: 1, labeled: true });
    expect((await json<{ total: number }>(await skipped(get("quality/skipped")))).total).toBe(1);

    const evaluation = await json<{ counts: { labels: number }; model: string; classification: { total: number }; extraction: { status: string } }>(await qualityEval(get("quality/eval")));
    expect(evaluation).toMatchObject({ model: "claude-haiku-5-5", counts: { labels: 2 }, classification: { total: 2 }, extraction: { status: "ok", labelsScored: 0 } });

    const deleted = await deleteAll(post("delete-all"));
    expect(deleted.status).toBe(200);
    expect(await json(await quality(get("quality")))).toEqual({ latest: null, history: [] });
    expect((await json<{ total: number }>(await skipped(get("quality/skipped")))).total).toBe(0);
    expect(labels.list("anonymous")).toEqual([]);
  });

  it("rejects bad feedback requests", async () => {
    await upload(uploadRequest([{ name: "order.eml", content: ORDER_EML }]));
    expect((await markReceipt(post("x", { class: "nonsense" }), params("a"))).status).toBe(400);
    expect((await markReceipt(post("x", { extra: 1 }), params("a"))).status).toBe(400);
    expect((await markReceipt(post("x", { class: "order" }), params("missing"))).status).toBe(404);
    expect((await markNotReceipt(post("x"), params("missing"))).status).toBe(404);
    const crossSite = new Request("http://localhost/api/x", { method: "POST", headers: { origin: "http://evil.example" } });
    expect((await markReceipt(crossSite, params("a"))).status).toBe(403);
    expect((await experiment(crossSite)).status).toBe(403);
  });

  it("answers 503 and still saves the label when no Claude key is configured", async () => {
    await upload(uploadRequest([{ name: "order.eml", content: ORDER_EML }, { name: "news.eml", content: NEWSLETTER_EML }]));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const response = await markReceipt(post("x"), params("news-1@edge.example"));
    expect(response.status).toBe(503);
    expect(await json(response)).toMatchObject({ error: expect.stringContaining("not configured"), details: { labeled: true } });
    expect(labels.list("anonymous")).toHaveLength(1);
    expect((await json<{ total: number }>(await skipped(get("quality/skipped")))).total).toBe(1);
  });

  it("the demo run is reported too, with its skipped marketing emails", async () => {
    expect((await demo(new Request("http://localhost/api/demo", { method: "POST" }))).status).toBe(200);
    const { latest } = await json<{ latest: Record<string, unknown> }>(await quality(get("quality")));
    expect(latest).toMatchObject({ source: "demo", llmCalls: 0, inputTokens: 0 });
    expect(latest.extracted).toBeGreaterThan(0);
    const list = await json<{ skipped: Array<{ reason: string }> }>(await skipped(get("quality/skipped")));
    expect(list.skipped.length).toBeGreaterThan(0);
    expect(list.skipped.every((entry) => ["prefilter", "marketing", "not_receipt", "phishing"].includes(entry.reason))).toBe(true);
  });
});

describe("experiment route", () => {
  it("compares the chosen model with the current one on the labeled set", async () => {
    await upload(uploadRequest([{ name: "order.eml", content: ORDER_EML }]));
    labels.upsert("anonymous", {
      emailId: "order-1@edge.example", source: "review", class: "order", redactedText: "Order #NW-2041\nOrder total: $120.00",
      textHash: "h-1", subject: "Order #NW-2041", from: '"Northwind" <sender@northwind.example>', date: "2026-10-01T10:00:00.000Z",
      at: "2026-10-17T10:00:00.000Z", fields: { merchant: "Northwind Outfitters", orderRef: "NW-2041", totals: { total: 120 } },
    });
    anthropicCalls.length = 0;
    const response = await experiment(post("quality/experiment", { model: "claude-sonnet-5-5", promptVariant: "conservative" }));
    expect(response.status).toBe(200);
    const result = await json<{ warning: string; labelsUsed: number; current: { model: string; llmCalls: number }; candidate: { model: string; promptVariant: string; llmCalls: number; overallAccuracy: number } }>(response);
    expect(result.warning).toMatch(/calls Claude/);
    expect(result).toMatchObject({ labelsUsed: 1, current: { model: "claude-haiku-5-5", llmCalls: 1 }, candidate: { model: "claude-sonnet-5-5", promptVariant: "conservative", llmCalls: 1, overallAccuracy: 1 } });
    expect(anthropicCalls.map((call) => call.model).sort()).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
    expect(process.env.LLM_MODEL).toBe("claude-haiku-5-5");
    expect(await json<{ entries: Array<{ detail: string }> }>(await (await import("@/app/api/audit/route")).GET(get("audit")))).toMatchObject({
      entries: expect.arrayContaining([expect.objectContaining({ detail: expect.stringContaining("Quality experiment started") })]),
    });
  });

  it("validates the request and needs labels", async () => {
    expect((await experiment(post("quality/experiment", { model: "bad model!" }))).status).toBe(400);
    expect((await experiment(post("quality/experiment", { promptVariant: "nope" }))).status).toBe(400);
    expect((await experiment(post("quality/experiment", {}))).status).toBe(400);
    expect(anthropicCalls).toHaveLength(0);
  });
});

describe("Gmail sync quality", () => {
  const key = () => authConfig().key;
  const tokens = (mailbox: string) => seal({ accessToken: `access-${mailbox}`, refreshToken: "r", expiresAt: Date.now() + 3600000, mailbox }, key(), "tokens");
  const message = (id: string, subject: string, mime: "text/plain" | "text/html", body: string) => ({
    id, internalDate: String(Date.parse("2026-10-01T10:00:00Z")),
    payload: { mimeType: mime, headers: [{ name: "From", value: '"Northwind Outfitters" <orders@northwind.example>' }, { name: "Subject", value: subject }],
      body: { data: Buffer.from(body).toString("base64url") } },
  });
  const inbox: Record<string, ReturnType<typeof message>> = {
    plain: message("plain", "Order confirmation #NW-1", "text/plain", "Thank you for your order #NW-1. Order total: $40.00."),
    html: message("html", "Order confirmation #NW-2", "text/html", "<html><body><table><tr><td>Order #NW-2</td></tr><tr><td>Order total</td><td>$40.00</td></tr></table></body></html>"),
    promo: { ...message("promo", "Weekly newsletter: autumn textures", "text/plain", "Five ways to layer textures. Unsubscribe any time."), payload: { mimeType: "text/plain", headers: [{ name: "From", value: '"The Oakhaven Journal" <journal@oakhaven.example>' }, { name: "Subject", value: "Weekly newsletter: autumn textures" }], body: { data: Buffer.from("Five ways to layer textures. Unsubscribe any time.").toString("base64url") } } },
  };

  it("reports per account with body sources, token usage and skipped emails, then answers feedback for that account", async () => {
    vi.stubEnv("AUTH_ENCRYPTION_KEY", "ab".repeat(32)); vi.stubEnv("AUTH_BASE_URL", "http://localhost:3000");
    vi.stubEnv("GOOGLE_CLIENT_ID", "c"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "s");
    const userId = db.save("a@example.test", tokens("a@example.test"));
    const cookie = seal({ userId, expiresAt: Date.now() + 3600000 }, key(), "session");
    const withCookie = (path: string, body?: unknown) => new Request(`http://localhost:3000/api/${path}`, { method: body === undefined ? "GET" : "POST",
      headers: { origin: "http://localhost:3000", cookie: `${SESSION_COOKIE}=${cookie}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "gmail.googleapis.com") {
        if (url.pathname.endsWith("/messages")) return Response.json({ messages: Object.keys(inbox).map((id) => ({ id })), resultSizeEstimate: 3 });
        return Response.json(inbox[url.pathname.split("/").at(-1)!]);
      }
      const body = JSON.parse(String(init?.body)) as { model: string; messages: Array<{ content: string }> };
      return Response.json(extractionBody(body.model, /#([A-Z0-9-]+)/.exec(body.messages[0].content)?.[1] ?? "NW-9", 40));
    }));

    const synced = await sync(withCookie("gmail/sync", { confirmed: true }));
    expect(synced.status).toBe(200);
    const { latest, history } = await json<{ latest: Record<string, unknown>; history: unknown[] }>(await quality(withCookie("quality")));
    expect(history).toHaveLength(1);
    expect(latest).toMatchObject({ source: "gmail", accountId: userId, fetched: 3, extracted: 2, matchedOrders: 2, llmCalls: 2, inputTokens: 240, outputTokens: 120, bodySource: { plain: 2, html: 1 } });
    const list = await json<{ skipped: Array<Record<string, unknown>> }>(await skipped(withCookie("quality/skipped")));
    expect(list.skipped).toEqual([expect.objectContaining({ emailId: "promo", accountId: userId, reason: expect.stringMatching(/prefilter|marketing/) })]);

    // Another profile sees none of it.
    const other = db.save("b@example.test", tokens("b@example.test"));
    const otherCookie = seal({ userId: other, expiresAt: Date.now() + 3600000 }, key(), "session");
    const otherReport = await quality(new Request("http://localhost:3000/api/quality", { headers: { cookie: `${SESSION_COOKIE}=${otherCookie}` } }));
    expect(await json(otherReport)).toEqual({ latest: null, history: [] });

    const receipt = await markReceipt(withCookie("x", {}), params("promo"));
    expect(receipt.status).toBe(200);
    expect((await json<{ orders: unknown[] }>(await ledger(withCookie("ledger")))).orders).toHaveLength(3);
    expect(labels.list(userId).map((label) => label.emailId)).toEqual(["promo"]);
    const afterwards = await json<{ history: unknown[] }>(await quality(withCookie("quality")));
    expect(afterwards.history).toHaveLength(1);
  });
});
