import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as account } from "@/app/api/account/route";
import { POST as sync } from "@/app/api/gmail/sync/route";
import { GET as status } from "@/app/api/gmail/sync/status/route";
import { GET as ledger } from "@/app/api/ledger/route";
import { GET as promotionsApi } from "@/app/api/promotions/route";
import { GET as quality } from "@/app/api/quality/route";
import { GET as skippedApi } from "@/app/api/quality/skipped/route";
import { authConfig, SESSION_COOKIE } from "@/lib/auth/config";
import { seal } from "@/lib/auth/crypto";
import { createAuthStore, type AuthStore } from "@/lib/auth/store";
import { ExtractionSchema } from "@/lib/contracts";
import { EXTRACTION_TOOL_NAME } from "@/lib/ingestion/extract-prompt";
import { GMAIL_RECEIPT_QUERY } from "@/lib/ingestion/prefilter";
import type { PipelineExtractor } from "@/lib/pipeline/run";
import { resetStore } from "@/lib/store";
import { GMAIL_PROMOTIONS_QUERY } from "./client";
import type { GmailWorkProgress } from "./progress";
import { promoFetchLimit, PROMO_MIN_BUDGET_MS } from "./promotions";
import { syncGmail } from "./service";

/** #137: the second Gmail list query (Promotions category) that feeds only the Promotions tab. Synthetic data, fake Gmail. */

const now = new Date("2026-10-17T00:00:00Z");

function gmailMessage(id: string, subject: string, from: string, text: string) {
  return { id, internalDate: String(Date.parse("2026-10-15T10:00:00Z")), payload: { mimeType: "text/plain", headers: [
    { name: "From", value: from }, { name: "Subject", value: subject },
  ], body: { data: Buffer.from(text).toString("base64url") } } };
}
const receiptMessage = (id: string, ref = id) =>
  gmailMessage(id, `Order confirmation #${ref}`, "orders@synthetic.example", `Thanks for your order #${ref}. Order total: $40.00.`);
/** A promotion from its own store, so two of them never collapse into one. */
const promoMessage = (id: string, store = id) =>
  gmailMessage(id, `${store.toUpperCase()}: 25% off sitewide`, `"Shop ${store}" <deals@${store}.example>`,
    `Save 25% on everything at ${store} with code ${store.toUpperCase()}25. Unsubscribe from promotional email any time.`);

interface FakeInbox { receipts: string[]; promotions: string[]; messages: Record<string, unknown> }
/** Fake Gmail over a fetcher: answers each list by its `q` (honoring maxResults) and each get by id; records every request. */
function fakeGmail(inbox: FakeInbox, options: { failPromotionList?: number; failPromotionGet?: (id: string) => Response | undefined; hangPromotionGet?: (id: string) => boolean } = {}) {
  const lists: Array<{ q: string; maxResults: number }> = [];
  const gets: string[] = [];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const q = url.searchParams.get("q");
    if (url.pathname.endsWith("/messages")) {
      const maxResults = Number(url.searchParams.get("maxResults"));
      lists.push({ q: q!, maxResults });
      if (q === GMAIL_PROMOTIONS_QUERY) {
        if (options.failPromotionList) return new Response("{}", { status: options.failPromotionList });
        return Response.json({ messages: inbox.promotions.slice(0, maxResults).map(id => ({ id })) });
      }
      return Response.json({ messages: inbox.receipts.slice(0, maxResults).map(id => ({ id })) });
    }
    const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
    gets.push(id);
    if (options.hangPromotionGet?.(id)) {
      await new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    }
    return options.failPromotionGet?.(id) ?? Response.json(inbox.messages[id]);
  });
  return { fetcher, lists, gets };
}

const extractor: PipelineExtractor = async (redacted, classification) => ({
  ok: true,
  extraction: ExtractionSchema.parse({ emailId: redacted.id, class: classification.class,
    fields: { merchant: "Synthetic Store", merchantDomain: "synthetic.example", orderRef: redacted.id, date: "2026-10-01",
      currency: "USD", totals: { total: 40 }, lineItems: [{ name: "Rain shell", qty: 1, unitPrice: 40 }] },
    confidence: { merchant: 0.95, orderRef: 0.95, totals: 0.95, date: 0.95, currency: 0.95 },
    evidence: { totals: "Order total: $40.00" }, confMin: 0.95, model: "synthetic-test", cached: false }),
});

function inboxOf(receipts: string[], promotions: string[]): FakeInbox {
  const messages: Record<string, unknown> = {};
  for (const id of receipts) messages[id] = receiptMessage(id);
  for (const id of promotions) messages[id] ??= promoMessage(id);
  return { receipts, promotions, messages };
}
const run = (gmail: ReturnType<typeof fakeGmail>, extra: Partial<Parameters<typeof syncGmail>[0]> = {}) => {
  const audit = vi.fn();
  return syncGmail({ accessToken: async () => "synthetic", fetcher: gmail.fetcher, audit, sleep: async () => undefined, pace: async () => undefined,
    pipeline: { now, extractor }, sourceAccount: "acct-1", promoFetchLimit: 30, ...extra }).then(synced => ({ synced, audit }));
};

describe("PROMO_FETCH_LIMIT", () => {
  it("defaults to 30, accepts 0 (off), caps at 100 and ignores junk", () => {
    expect(promoFetchLimit(undefined)).toBe(30);
    expect(promoFetchLimit("")).toBe(30);
    expect(promoFetchLimit("0")).toBe(0);
    expect(promoFetchLimit("12")).toBe(12);
    expect(promoFetchLimit("5000")).toBe(100);
    expect(promoFetchLimit("-3")).toBe(30);
    expect(promoFetchLimit("lots")).toBe(30);
  });
});

describe("the promotions pass of syncGmail", () => {
  it("runs a second, separate list query with the right q and maxResults after the receipt query", async () => {
    const gmail = fakeGmail(inboxOf(["r1", "r2"], ["p1", "p2", "p3"]));
    const { synced } = await run(gmail);
    expect(gmail.lists).toEqual([
      { q: GMAIL_RECEIPT_QUERY, maxResults: 50 },
      { q: "category:promotions newer_than:30d", maxResults: 30 },
    ]);
    expect(synced.result.orders).toHaveLength(2);
    expect(synced.fetched).toBe(2);
    expect(synced.promotions).toMatchObject({ listed: 3 });
    expect(synced.promotions?.emails.map(email => email.id)).toEqual(["p1", "p2", "p3"]);
    expect(synced.promotions?.emails.every(email => email.sourceAccount === "acct-1")).toBe(true);
    expect(synced.promotions?.warning).toBeUndefined();
    // Receipts are fetched before any promotion.
    expect(gmail.gets.slice(0, 2).sort()).toEqual(["r1", "r2"]);
  });

  it("never turns a promotion into an order, a review item or a quality count of receipts", async () => {
    const { synced } = await run(fakeGmail(inboxOf(["r1"], ["p1", "p2"])));
    expect(synced.result.orders.map(order => order.orderRef)).toEqual(["r1"]);
    expect(synced.result.stats.emails).toBe(1);
    expect(synced.result.reviewQueue).toEqual([]);
  });

  it("respects the cap: asks Gmail for at most the limit and reads no more", async () => {
    const promotions = Array.from({ length: 40 }, (_, i) => `p${i}`);
    const gmail = fakeGmail(inboxOf(["r1"], promotions));
    const { synced } = await run(gmail, { promoFetchLimit: 7 });
    expect(gmail.lists.at(-1)).toEqual({ q: GMAIL_PROMOTIONS_QUERY, maxResults: 7 });
    expect(synced.promotions?.emails).toHaveLength(7);
    expect(gmail.gets.filter(id => id.startsWith("p"))).toHaveLength(7);
    const capped = fakeGmail(inboxOf(["r1"], promotions));
    await run(capped, { promoFetchLimit: 100000 });
    expect(capped.lists.at(-1)?.maxResults).toBe(100);
  });

  it("does not fetch a message the receipt pass already fetched", async () => {
    const inbox = inboxOf(["r1", "shared"], ["shared", "p1"]);
    const gmail = fakeGmail(inbox);
    const { synced } = await run(gmail);
    expect(gmail.gets.filter(id => id === "shared")).toHaveLength(1);
    expect(synced.promotions?.emails.map(email => email.id)).toEqual(["p1"]);
    expect(synced.result.orders.map(order => order.orderRef).sort()).toEqual(["r1", "shared"]);
  });

  it("is off with PROMO_FETCH_LIMIT 0: one list query, no promotions result", async () => {
    const gmail = fakeGmail(inboxOf(["r1"], ["p1"]));
    const { synced } = await run(gmail, { promoFetchLimit: 0 });
    expect(gmail.lists).toHaveLength(1);
    expect(gmail.gets).toEqual(["r1"]);
    expect(synced.promotions).toBeUndefined();
  });

  it("isolates a failing promotions list: the receipts still sync and the result carries a warning", async () => {
    const gmail = fakeGmail(inboxOf(["r1", "r2"], ["p1"]), { failPromotionList: 403 });
    const { synced } = await run(gmail);
    expect(synced.result.orders).toHaveLength(2);
    expect(synced.promotions).toEqual({ emails: [], listed: 0, warning: "gmail_access_denied" });
  });

  it("isolates a failing promotion fetch: keeps what was read and warns", async () => {
    const gmail = fakeGmail(inboxOf(["r1"], ["p1", "p2", "p3"]),
      { failPromotionGet: id => (id === "p2" ? new Response("{}", { status: 403 }) : undefined) });
    const { synced } = await run(gmail);
    expect(synced.result.orders).toHaveLength(1);
    expect(synced.promotions?.warning).toBe("gmail_access_denied");
    expect(synced.promotions?.emails.map(email => email.id)).toEqual(expect.not.arrayContaining(["p2"]));
  });

  it("skips a promotion that vanished (404) without a warning", async () => {
    const gmail = fakeGmail(inboxOf(["r1"], ["p1", "gone"]), { failPromotionGet: id => (id === "gone" ? new Response("{}", { status: 404 }) : undefined) });
    const { synced } = await run(gmail);
    expect(synced.promotions?.emails.map(email => email.id)).toEqual(["p1"]);
    expect(synced.promotions?.warning).toBeUndefined();
  });

  it("does not start the promotions pass when the receipt pass left no budget", async () => {
    const gmail = fakeGmail(inboxOf(["r1"], ["p1"]));
    const { synced } = await run(gmail, { budgetMs: PROMO_MIN_BUDGET_MS - 1 });
    expect(gmail.lists).toHaveLength(1);
    expect(synced.result.orders).toHaveLength(1);
    expect(synced.promotions).toEqual({ emails: [], listed: 0, warning: "promotions_timeout" });
  });

  it("stops the promotions pass at the remaining budget and keeps what it read", async () => {
    const gmail = fakeGmail(inboxOf(["r1"], ["p1", "p2"]), { hangPromotionGet: id => id === "p2" });
    const { synced } = await run(gmail, { budgetMs: PROMO_MIN_BUDGET_MS + 150 });
    expect(synced.result.orders).toHaveLength(1);
    expect(synced.promotions?.warning).toBe("promotions_timeout");
    expect(synced.promotions?.emails.map(email => email.id)).toEqual(["p1"]);
  }, 10000);

  it("still fails the whole sync when the user cancels during the promotions pass", async () => {
    const controller = new AbortController();
    const gmail = fakeGmail(inboxOf(["r1"], ["p1"]), { hangPromotionGet: id => id === "p1" });
    const pending = run(gmail, { signal: controller.signal });
    pending.catch(() => undefined);
    await vi.waitFor(() => expect(gmail.gets).toContain("p1"));
    controller.abort();
    await expect(pending).rejects.toBeDefined();
  });

  it("audits the promotions list and every promotion get, tagged as promotions; receipt rows stay as before", async () => {
    const { audit } = await run(fakeGmail(inboxOf(["r1"], ["p1", "p2"])));
    const rows = audit.mock.calls.map(([action, meta]): { action: string; endpoint?: string; purpose?: string; messageId?: string } =>
      ({ action, ...(meta as Record<string, string>) }));
    expect(rows.every(row => row.action === "gmail.fetch")).toBe(true);
    const lists = rows.filter(row => row.endpoint === "messages.list");
    expect(lists).toEqual([
      { action: "gmail.fetch", endpoint: "messages.list", attempt: 1, query: GMAIL_RECEIPT_QUERY },
      { action: "gmail.fetch", endpoint: "messages.list", attempt: 1, query: GMAIL_PROMOTIONS_QUERY, purpose: "promotions" },
    ]);
    const gets = rows.filter(row => row.endpoint === "messages.get");
    expect(gets.filter(row => row.purpose === "promotions").map(row => row.messageId).sort()).toEqual(["p1", "p2"]);
    expect(gets.filter(row => row.purpose === undefined).map(row => row.messageId)).toEqual(["r1"]);
  });

  it("reports a Reading promotions stage with its own counts after the receipt stages", async () => {
    const progress: GmailWorkProgress[] = [];
    await run(fakeGmail(inboxOf(["r1", "r2"], ["p1", "p2", "p3"])), { onProgress: value => progress.push(value) });
    const stages = progress.map(value => value.stage);
    expect(stages.indexOf("promotions")).toBeGreaterThan(stages.lastIndexOf("processing"));
    const promos = progress.filter(value => value.stage === "promotions");
    expect(promos[0]).toEqual({ stage: "promotions", fetched: 2, total: 2, skipped: 0, promotions: { fetched: 0, total: null } });
    expect(promos.at(-1)).toEqual({ stage: "promotions", fetched: 2, total: 2, skipped: 0, promotions: { fetched: 3, total: 3 } });
    expect(promos.some(value => value.promotions?.total === 3 && value.promotions.fetched === 0)).toBe(true);
  });
});

// ---- Through the sync route, with a profile of two linked accounts ----

let db: AuthStore;
vi.mock("@/lib/auth/store", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/auth/store")>();
  return { ...original, authStore: () => db };
});
const key = () => authConfig().key;
const tokens = (mailbox: string) =>
  seal({ accessToken: `access-${mailbox}`, refreshToken: `refresh-${mailbox}`, expiresAt: Date.now() + 3600000, mailbox }, key(), "tokens");
function profile() {
  const id = db.save("a@example.test", tokens("a@example.test"));
  const linked = db.link(id, "b@example.test", tokens("b@example.test"));
  return { a: id, b: linked, cookie: seal({ userId: id, expiresAt: Date.now() + 3600000 }, key(), "session") };
}
function req(path: string, cookie: string, body?: unknown) {
  return new Request(`http://localhost:3000/api/${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { origin: "http://localhost:3000", cookie: `${SESSION_COOKIE}=${cookie}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

let inboxes: Record<string, FakeInbox>;
let failPromotions: Set<string>;
let listQueries: Array<{ token: string; q: string }>;
function stubProviders() {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "gmail.googleapis.com") {
      const token = new Headers(init?.headers).get("authorization")!.replace("Bearer ", "");
      const inbox = inboxes[token];
      if (url.pathname.endsWith("/messages")) {
        const q = url.searchParams.get("q")!;
        listQueries.push({ token, q });
        if (q === GMAIL_PROMOTIONS_QUERY) {
          if (failPromotions.has(token)) return new Response("{}", { status: 403 });
          return Response.json({ messages: inbox.promotions.slice(0, Number(url.searchParams.get("maxResults"))).map(id => ({ id })) });
        }
        return Response.json({ messages: inbox.receipts.map(id => ({ id })) });
      }
      return Response.json(inbox.messages[url.pathname.split("/").at(-1)!]);
    }
    if (url.hostname === "api.anthropic.com") {
      const orderRef = /order #([A-Za-z0-9-]+)/.exec((JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }).messages[0].content)![1];
      return Response.json({ model: "synthetic-model", usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: "tool_use",
        name: EXTRACTION_TOOL_NAME, input: {
          fields: { merchant: "Synthetic Store", merchantDomain: "synthetic.example", orderRef, date: "2026-09-01", currency: "USD",
            totals: { total: 40 }, lineItems: [{ name: `Item ${orderRef}`, qty: 1, unitPrice: 40 }] },
          confidence: { merchant: 0.95, merchantDomain: 0.95, orderRef: 0.95, date: 0.95, currency: 0.95, totals: 0.95, lineItems: 0.95 },
          evidence: { totals: "Order total: $40.00" } } }] });
    }
    throw new Error(`Unexpected provider endpoint ${url.hostname}`);
  }));
}
const setInboxes = (a: FakeInbox, b: FakeInbox) => { inboxes = { "access-a@example.test": a, "access-b@example.test": b }; };

describe("the sync route with promotions", () => {
  beforeEach(() => {
    db = createAuthStore(":memory:"); resetStore(); failPromotions = new Set(); listQueries = [];
    vi.stubEnv("AUTH_ENCRYPTION_KEY", "ab".repeat(32)); vi.stubEnv("AUTH_BASE_URL", "http://localhost:3000");
    vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-secret");
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-key"); vi.stubEnv("LLM_MODEL", "synthetic-model");
    vi.stubEnv("PROMO_LLM_LIMIT", "0"); // rules only: Claude's background pass is #131's, covered there
    setInboxes(inboxOf(["a-r1", "a-r2"], ["a-p1", "a-p2", "shared-a"]), inboxOf(["b-r1"], ["b-p1"]));
    stubProviders();
  });
  afterEach(() => { db.close(); resetStore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  const promotionIds = async (cookie: string) =>
    ((await (await promotionsApi(req("promotions", cookie))).json()).promotions as Array<{ id: string; accountId?: string }>)
      .map(promotion => promotion.id).sort();

  it("reads each account's promotions with its own queries and lists them on the Promotions tab only", async () => {
    const { a, b, cookie } = profile();
    const response = await sync(req("gmail/sync", cookie, { confirmed: true }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ fetched: 3, promotionsFound: 4 });
    expect(body.promotionsWarning).toBeUndefined();
    expect(body.accounts).toEqual([
      expect.objectContaining({ accountId: a, ok: true, fetched: 2, promotionsFound: 3 }),
      expect.objectContaining({ accountId: b, ok: true, fetched: 1, promotionsFound: 1 }),
    ]);
    // Two queries per account.
    for (const token of ["access-a@example.test", "access-b@example.test"]) {
      expect(listQueries.filter(entry => entry.token === token).map(entry => entry.q)).toEqual([GMAIL_RECEIPT_QUERY, GMAIL_PROMOTIONS_QUERY]);
    }
    expect(await promotionIds(cookie)).toEqual(["a-p1", "a-p2", "b-p1", "shared-a"]);
    const promotions = (await (await promotionsApi(req("promotions", cookie))).json()).promotions as Array<{ id: string; accountId?: string }>;
    expect(promotions.find(promotion => promotion.id === "b-p1")?.accountId).toBe(b);
    // Never in the ledger or the owed total: only the receipts' orders exist.
    const ledgerBody = await (await ledger(req("ledger", cookie))).json();
    expect(ledgerBody.orders.map((order: { orderRef: string }) => order.orderRef).sort()).toEqual(["a-r1", "a-r2", "b-r1"]);
    expect(ledgerBody.stats.emails).toBe(3);
    expect(JSON.stringify(ledgerBody)).not.toContain("a-p1");
  });

  it("reports the promotions in the quality report (not as receipts) and keeps them out of the skipped list", async () => {
    const { a, cookie } = profile();
    await sync(req("gmail/sync", cookie, { confirmed: true }));
    const reports = (await (await quality(req("quality", cookie))).json()).history as Array<{ accountId?: string; fetched: number; promotionsFetched?: number; skippedNonReceipt: number }>;
    const first = reports.find(report => report.accountId === a)!;
    expect(first).toMatchObject({ fetched: 2, promotionsFetched: 3, skippedNonReceipt: 0 });
    const skipped = (await (await skippedApi(req("quality/skipped", cookie))).json()).skipped as Array<{ emailId: string }>;
    expect(skipped).toEqual([]);
  });

  it("shows the promotion counts in the finished sync status and marks the account as not syncing", async () => {
    const { cookie } = profile();
    await sync(req("gmail/sync", cookie, { confirmed: true }));
    expect(await (await status(req("gmail/sync/status", cookie))).json()).toMatchObject({
      stage: "complete", promotions: { fetched: 4, total: 4 },
    });
    expect((await (await account(req("account", cookie))).json()).syncing).toBe(false);
  });

  it("does not fetch a message the receipt pass fetched, per account", async () => {
    const { cookie } = profile();
    setInboxes(inboxOf(["a-r1"], ["a-r1", "a-p1"]), inboxOf(["b-r1"], ["b-r1"]));
    stubProviders();
    const body = await (await sync(req("gmail/sync", cookie, { confirmed: true }))).json();
    expect(body.promotionsFound).toBe(1);
    expect(await promotionIds(cookie)).toEqual(["a-p1"]);
  });

  it("skips the second query with PROMO_FETCH_LIMIT=0", async () => {
    vi.stubEnv("PROMO_FETCH_LIMIT", "0");
    const { cookie } = profile();
    const body = await (await sync(req("gmail/sync", cookie, { confirmed: true }))).json();
    expect(listQueries.every(entry => entry.q === GMAIL_RECEIPT_QUERY)).toBe(true);
    expect(body.promotionsFound).toBe(0);
    expect(body.accounts[0].promotionsFound).toBeUndefined();
    expect(await promotionIds(cookie)).toEqual([]);
    expect((await (await ledger(req("ledger", cookie))).json()).orders).toHaveLength(3);
  });

  it("honors PROMO_FETCH_LIMIT as the per-account cap", async () => {
    vi.stubEnv("PROMO_FETCH_LIMIT", "2");
    const { cookie } = profile();
    const body = await (await sync(req("gmail/sync", cookie, { confirmed: true }))).json();
    expect(body.accounts.map((entry: { promotionsFound: number }) => entry.promotionsFound)).toEqual([2, 1]);
    expect(await promotionIds(cookie)).toEqual(["a-p1", "a-p2", "b-p1"]);
  });

  it("publishes the receipts and warns when one account's promotions fail, keeping its earlier promotions", async () => {
    const { a, cookie } = profile();
    await sync(req("gmail/sync", cookie, { confirmed: true }));
    expect(await promotionIds(cookie)).toContain("a-p1");
    failPromotions.add("access-a@example.test");
    setInboxes(inboxOf(["a-r1", "a-r2", "a-r3"], ["a-p1"]), inboxes["access-b@example.test"]);
    const response = await sync(req("gmail/sync", cookie, { confirmed: true }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.promotionsWarning).toBe("gmail_access_denied");
    expect(body.accounts[0]).toMatchObject({ accountId: a, ok: true, fetched: 3, promotionsFound: 0, promotionsWarning: "gmail_access_denied" });
    expect(body.accounts[1]).toMatchObject({ ok: true, promotionsFound: 1 });
    expect(body.accounts[1].promotionsWarning).toBeUndefined();
    expect((await (await ledger(req("ledger", cookie))).json()).orders.map((order: { orderRef: string }) => order.orderRef))
      .toEqual(expect.arrayContaining(["a-r3"]));
    expect(await promotionIds(cookie)).toEqual(["a-p1", "a-p2", "b-p1", "shared-a"]);
  });

  it("replaces an account's promotions when its promotions pass succeeds again", async () => {
    const { cookie } = profile();
    await sync(req("gmail/sync", cookie, { confirmed: true }));
    setInboxes(inboxOf(["a-r1", "a-r2"], ["a-p1"]), inboxes["access-b@example.test"]);
    await sync(req("gmail/sync", cookie, { confirmed: true }));
    expect(await promotionIds(cookie)).toEqual(["a-p1", "b-p1"]);
  });

  it("audits both lists and every get in the account's audit stream", async () => {
    const { cookie } = profile();
    await sync(req("gmail/sync", cookie, { confirmed: true }));
    const { GET: auditApi } = await import("@/app/api/audit/route");
    const text = await (await auditApi(req("audit", cookie))).text();
    expect(text.match(/gmail_fetch/g)?.length).toBe(
      // per account: receipt list + receipt gets + promotions list + promotion gets
      (1 + 2 + 1 + 3) + (1 + 1 + 1 + 1));
    expect(text).toContain("messages.list (promotions) attempt 1");
    expect(text.match(/messages\.get \(promotions\) attempt 1 message/g)).toHaveLength(4);
  });
});
