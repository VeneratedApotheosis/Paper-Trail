import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as account } from "@/app/api/account/route";
import { GET as audit } from "@/app/api/audit/route";
import { POST as disconnect } from "@/app/api/auth/disconnect/route";
import { POST as deleteAll } from "@/app/api/delete-all/route";
import { GET as preview } from "@/app/api/gmail/preview/route";
import { POST as sync } from "@/app/api/gmail/sync/route";
import { GET as status } from "@/app/api/gmail/sync/status/route";
import { GET as ledger } from "@/app/api/ledger/route";
import { authConfig, SESSION_COOKIE } from "@/lib/auth/config";
import { seal } from "@/lib/auth/crypto";
import { createAuthStore, type AuthStore } from "@/lib/auth/store";
import { EXTRACTION_TOOL_NAME } from "@/lib/ingestion/extract-prompt";
import { getAccountSyncTimes, getState, resetStore, withStoreScope } from "@/lib/store";
import { syncGmailAccounts, type GmailAccountTarget } from "./accounts";
import * as service from "./service";

let db: AuthStore;
vi.mock("@/lib/auth/store", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/auth/store")>();
  return { ...original, authStore: () => db };
});
const key = () => authConfig().key;
const tokens = (mailbox: string, overrides: Record<string, unknown> = {}) =>
  seal({ accessToken: `access-${mailbox}`, refreshToken: `refresh-${mailbox}`, expiresAt: Date.now() + 3600000, mailbox, ...overrides }, key(), "tokens");
/** A profile with its own mailbox (account A) and one linked mailbox (account B). */
function profile() {
  const id = db.save("a@example.test", tokens("a@example.test"));
  const linked = db.link(id, "b@example.test", tokens("b@example.test"));
  return { id, a: id, b: linked, cookie: seal({ userId: id, expiresAt: Date.now() + 3600000 }, key(), "session") };
}
function req(path: string, cookie: string, body?: unknown) {
  return new Request(`http://localhost:3000/api/${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { origin: "http://localhost:3000", cookie: `${SESSION_COOKIE}=${cookie}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

// Fake Gmail + Anthropic over global fetch. Inboxes are keyed by the account's access token.
type Inbox = Array<{ id: string; ref: string }>;
let inboxes: Record<string, Inbox>;
const refOf = new Map<string, string>();
function message(id: string, ref: string) {
  return { id, internalDate: String(Date.parse("2026-09-01T10:00:00Z")), payload: { mimeType: "text/plain", headers: [
    { name: "From", value: "orders@synthetic.example" }, { name: "Subject", value: `Order confirmation #${ref}` },
  ], body: { data: Buffer.from(`Thank you for your order #${ref}. Order total: $40.00.`).toString("base64url") } } };
}
function stubProviders() {
  const calls = { gmail: [] as string[], revoked: [] as string[] };
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "gmail.googleapis.com") {
      const token = new Headers(init?.headers).get("authorization")!.replace("Bearer ", "");
      calls.gmail.push(token);
      const inbox = inboxes[token] ?? [];
      if (url.pathname.endsWith("/messages")) {
        return Response.json({ messages: inbox.map(item => ({ id: item.id })), resultSizeEstimate: inbox.length });
      }
      const id = url.pathname.split("/").at(-1)!;
      return Response.json(message(id, inbox.find(item => item.id === id)!.ref));
    }
    if (url.hostname === "api.anthropic.com") {
      const prompt = (JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }).messages[0].content;
      const orderRef = /order #([A-Z0-9-]+)/.exec(prompt)![1];
      return Response.json({ model: "synthetic-model", usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: "tool_use",
        name: EXTRACTION_TOOL_NAME, input: {
          fields: { merchant: "Synthetic Store", merchantDomain: "synthetic.example", orderRef, date: "2026-09-01", currency: "USD",
            totals: { total: 40 }, lineItems: [{ name: `Item ${orderRef}`, qty: 1, unitPrice: 40 }] },
          confidence: { merchant: 0.95, merchantDomain: 0.95, orderRef: 0.95, date: 0.95, currency: 0.95, totals: 0.95, lineItems: 0.95 },
          evidence: { totals: "Order total: $40.00" } } }] });
    }
    if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/revoke") {
      calls.revoked.push((init?.body as URLSearchParams).get("token")!);
      return new Response(null, { status: 200 });
    }
    throw new Error(`Unexpected provider endpoint ${url.hostname}`);
  }));
  return calls;
}
const setInboxes = (a: Inbox, b: Inbox) => {
  inboxes = { "access-a@example.test": a, "access-b@example.test": b };
};
const SHARED = "NW-1";

beforeEach(() => {
  db = createAuthStore(":memory:"); resetStore(); refOf.clear();
  vi.stubEnv("AUTH_ENCRYPTION_KEY", "ab".repeat(32)); vi.stubEnv("AUTH_BASE_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-secret");
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-key"); vi.stubEnv("LLM_MODEL", "synthetic-model");
  // The shared order arrives in both inboxes under different message ids; each inbox also has an order of its own.
  setInboxes([{ id: "a1", ref: SHARED }, { id: "a2", ref: "A-ONLY" }], [{ id: "b1", ref: SHARED }, { id: "b2", ref: "B-ONLY" }]);
});
afterEach(() => { db.close(); resetStore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const orderSources = async (cookie: string) =>
  Object.fromEntries((await (await ledger(req("ledger", cookie))).json()).orders.map((order: { orderRef: string; sources: string[] }) => [order.orderRef, order.sources]));

describe("Gmail sync across linked accounts", () => {
  it("syncs every account into one ledger and merges the order both inboxes saw, with both sources", async () => {
    stubProviders();
    const { cookie, a, b } = profile();
    const response = await sync(req("gmail/sync", cookie, { confirmed: true }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ mode: "gmail", fetched: 4, capped: false, parseErrors: [], stats: { orders: 3 } });
    expect(body.accounts).toEqual([
      { accountId: a, mailbox: "a@example.test", ok: true, fetched: 2, capped: false },
      { accountId: b, mailbox: "b@example.test", ok: true, fetched: 2, capped: false },
    ]);
    expect(await orderSources(cookie)).toEqual({ [SHARED]: [a, b].sort(), "A-ONLY": [a], "B-ONLY": [b] });
    const shared = (await (await ledger(req("ledger", cookie))).json()).orders.find((order: { orderRef: string }) => order.orderRef === SHARED);
    expect(shared.messageIds.sort()).toEqual(["a1", "b1"]);
    expect(shared.total).toBe(40); // not 80: one order, not two
    const info = await (await account(req("account", cookie))).json();
    expect(info.accounts.map((item: { id: string; lastSyncAt: string | null }) => [item.id, item.lastSyncAt !== null])).toEqual([[a, true], [b, true]]);
    expect(info.counts.orders).toBe(3);
    expect(await (await status(req("gmail/sync/status", cookie))).json()).toEqual({
      stage: "complete", fetched: 4, total: 4, skipped: 0, accounts: [
        { accountId: a, mailbox: "a@example.test", stage: "complete", fetched: 2, total: 2 },
        { accountId: b, mailbox: "b@example.test", stage: "complete", fetched: 2, total: 2 },
      ],
    });
    expect(await (await audit(req("audit", cookie))).text()).toContain("[b@example.test]");
  });

  it("syncing one account keeps the other account's orders, and replaces only its own", async () => {
    const calls = stubProviders();
    const { cookie, a, b } = profile();
    await sync(req("gmail/sync", cookie, { confirmed: true }));
    // Account B's inbox changed: the shared order is still there, B's own order is gone, a new one arrived.
    setInboxes([], [{ id: "b1", ref: SHARED }, { id: "b3", ref: "B-NEW" }]);
    calls.gmail.length = 0;
    const response = await sync(req("gmail/sync", cookie, { confirmed: true, accountId: b }));
    expect(response.status).toBe(200);
    expect((await response.json()).accounts).toEqual([{ accountId: b, mailbox: "b@example.test", ok: true, fetched: 2, capped: false }]);
    expect(new Set(calls.gmail)).toEqual(new Set(["access-b@example.test"])); // account A was not read
    expect(await orderSources(cookie)).toEqual({ [SHARED]: [a, b].sort(), "A-ONLY": [a], "B-NEW": [b] });
    // Now A re-syncs and loses everything: B's orders stay, the shared one is B's alone.
    const emptied = await sync(req("gmail/sync", cookie, { confirmed: true, accountId: a }));
    expect(emptied.status).toBe(200);
    expect(await orderSources(cookie)).toEqual({ [SHARED]: [b], "B-NEW": [b] });
  });

  it("rejects an unknown account id without reading any mailbox", async () => {
    const calls = stubProviders();
    const { cookie } = profile();
    const response = await sync(req("gmail/sync", cookie, { confirmed: true, accountId: "unknown" }));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "account_not_found" });
    expect((await preview(req("gmail/preview?accountId=unknown", cookie))).status).toBe(404);
    expect((await sync(req("gmail/sync", cookie, { confirmed: true, accountId: "" }))).status).toBe(400);
    expect(calls.gmail).toEqual([]);
  });

  it("keeps syncing the other accounts when one is expired, and reports it", async () => {
    const calls = stubProviders();
    const { cookie, a, b, id } = profile();
    db.updateAccount(id, b, tokens("b@example.test", { refreshExpiresAt: Date.now() - 1000 }));
    const response = await sync(req("gmail/sync", cookie, { confirmed: true }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accounts).toEqual([
      { accountId: a, mailbox: "a@example.test", ok: true, fetched: 2, capped: false },
      { accountId: b, mailbox: "b@example.test", ok: false, code: "token_expired" },
    ]);
    expect(body.fetched).toBe(2);
    expect(await orderSources(cookie)).toEqual({ [SHARED]: [a], "A-ONLY": [a] });
    expect(calls.gmail).not.toContain("access-b@example.test");
    expect(await (await status(req("gmail/sync/status", cookie))).json()).toMatchObject({
      stage: "complete", accounts: [{ accountId: a, stage: "complete" }, { accountId: b, stage: "failed" }] });
    // Asking for the expired account alone fails like a single-account sync always did.
    const alone = await sync(req("gmail/sync", cookie, { confirmed: true, accountId: b }));
    expect(alone.status).toBe(401);
    expect(await alone.json()).toMatchObject({ code: "token_expired", reconnectUrl: "/api/auth/google" });
  });

  it("fails like a single account when no account can be read, without touching the ledger", async () => {
    stubProviders();
    const { cookie, id, a, b } = profile();
    await sync(req("gmail/sync", cookie, { confirmed: true }));
    db.updateAccount(id, a, null); db.updateAccount(id, b, null);
    expect((await sync(req("gmail/sync", cookie, { confirmed: true }))).status).toBe(401);
    expect((await preview(req("gmail/preview", cookie))).status).toBe(401);
    expect(Object.keys(await orderSources(cookie))).toHaveLength(3);
  });

  it("a Gmail error on one account fails only that account and keeps its earlier results", async () => {
    stubProviders();
    const { cookie, a, b } = profile();
    await sync(req("gmail/sync", cookie, { confirmed: true }));
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (input, init) =>
      new Headers(init?.headers).get("authorization") === "Bearer access-b@example.test" && String(input).includes("gmail.googleapis.com")
        ? new Response("{}", { status: 403 }) : original(input, init)));
    const response = await sync(req("gmail/sync", cookie, { confirmed: true }));
    expect(response.status).toBe(200);
    expect((await response.json()).accounts[1]).toEqual({ accountId: b, mailbox: "b@example.test", ok: false, code: "gmail_access_denied" });
    expect(await orderSources(cookie)).toEqual({ [SHARED]: [a, b].sort(), "A-ONLY": [a], "B-ONLY": [b] });
  });
});

describe("Gmail preview across linked accounts", () => {
  it("sums the accounts that answer and reports the expired one", async () => {
    stubProviders();
    const { cookie, a, b, id } = profile();
    const both = await (await preview(req("gmail/preview", cookie))).json();
    expect(both).toMatchObject({ estimatedMessages: 4, messagesToFetch: 4, countIsEstimate: true, maxMessages: 50 });
    expect(both.accounts).toEqual([
      { accountId: a, mailbox: "a@example.test", ok: true, estimatedMessages: 2, messagesToFetch: 2 },
      { accountId: b, mailbox: "b@example.test", ok: true, estimatedMessages: 2, messagesToFetch: 2 },
    ]);
    db.updateAccount(id, b, tokens("b@example.test", { refreshExpiresAt: Date.now() - 1000 }));
    const partial = await preview(req("gmail/preview", cookie));
    expect(partial.status).toBe(200);
    expect(await partial.json()).toMatchObject({ estimatedMessages: 2, accounts: [{ accountId: a, ok: true },
      { accountId: b, mailbox: "b@example.test", ok: false, code: "token_expired" }] });
    const one = await (await preview(req(`gmail/preview?accountId=${a}`, cookie))).json();
    expect(one.accounts).toHaveLength(1);
    expect((await preview(req(`gmail/preview?accountId=${b}`, cookie))).status).toBe(401);
  });
});

describe("disconnecting and deleting with synced accounts", () => {
  it("disconnecting one account keeps its purchases visible, sourced from a disconnected account", async () => {
    const calls = stubProviders();
    const { cookie, a, b } = profile();
    await sync(req("gmail/sync", cookie, { confirmed: true }));
    expect((await disconnect(req("auth/disconnect", cookie, { accountId: b }))).status).toBe(200);
    expect(calls.revoked).toEqual(["refresh-b@example.test"]);
    expect(await orderSources(cookie)).toEqual({ [SHARED]: [a, b].sort(), "A-ONLY": [a], "B-ONLY": [b] });
    const info = await (await account(req("account", cookie))).json();
    expect(info.accounts).toEqual([
      expect.objectContaining({ id: a, mailbox: "a@example.test", connected: true }),
      expect.objectContaining({ id: b, mailbox: null, connected: false, expired: true, lastSyncAt: expect.any(String) }),
    ]);
    expect(info.counts.orders).toBe(3);
    // Account A still syncs; B's orders stay as they were.
    expect((await sync(req("gmail/sync", cookie, { confirmed: true }))).status).toBe(200);
    expect(await orderSources(cookie)).toEqual({ [SHARED]: [a, b].sort(), "A-ONLY": [a], "B-ONLY": [b] });
  });

  it("delete-all removes the profile, every linked account and the whole ledger", async () => {
    const calls = stubProviders();
    const { cookie, id } = profile();
    await sync(req("gmail/sync", cookie, { confirmed: true }));
    expect(withStoreScope(id, () => Object.keys(getAccountSyncTimes()))).toHaveLength(2);
    const response = await deleteAll(req("delete-all", cookie, {}));
    expect(response.status).toBe(200);
    expect(calls.revoked.sort()).toEqual(["refresh-a@example.test", "refresh-b@example.test"]);
    expect(db.accounts(id)).toEqual([]);
    expect(withStoreScope(id, () => getAccountSyncTimes())).toEqual({});
    expect(withStoreScope(id, getState).orders).toEqual([]);
    expect((await ledger(req("ledger", cookie))).status).toBe(401);
  });
});

describe("progress across accounts", () => {
  it("reports each account while the sync runs one account after another", async () => {
    const { cookie, a, b } = profile();
    let release!: () => void;
    const empty = { result: { orders: [], findings: [], reviewQueue: [], stats: { emails: 0, prefilteredOut: 0, classes: {}, extracted: 0,
      skipped: 0, extractionOrigins: { llm: 0, cache: 0, gold: 0 }, orders: 0, excludedOrders: 0, findings: 0, needsReview: 0 } },
      fetched: 0, capped: false, parseErrors: [] };
    vi.spyOn(service, "syncGmail").mockImplementation(async options => {
      options.onProgress?.({ stage: "fetching", fetched: 2, total: 5, skipped: 1 });
      if (options.sourceAccount === a) await new Promise<void>(resolve => { release = resolve; });
      return empty;
    });
    const pending = sync(req("gmail/sync", cookie, { confirmed: true }));
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(await (await status(req("gmail/sync/status", cookie))).json()).toEqual({
      stage: "fetching", fetched: 2, total: null, skipped: 1, accounts: [
        { accountId: a, mailbox: "a@example.test", stage: "fetching", fetched: 2, total: 5 },
        { accountId: b, mailbox: "b@example.test", stage: "idle", fetched: 0, total: null },
      ] });
    release();
    expect((await pending).status).toBe(200);
    expect(await (await status(req("gmail/sync/status", cookie))).json()).toMatchObject({
      stage: "complete", fetched: 4, total: 10, skipped: 2 });
  });
});

describe("syncGmailAccounts time budget", () => {
  const target = (id: string): GmailAccountTarget => ({ id, mailbox: null, connected: true, active: () => true,
    deps: { accessToken: async () => "synthetic", audit: () => undefined } });
  const result = { orders: [], findings: [], reviewQueue: [], stats: { emails: 0, prefilteredOut: 0, classes: {}, extracted: 0, skipped: 0,
    extractionOrigins: { llm: 0, cache: 0, gold: 0 }, orders: 0, excludedOrders: 0, findings: 0, needsReview: 0 } };

  it("splits the total budget between accounts and gives unused time to the later ones", async () => {
    const budgets: number[] = [];
    vi.spyOn(service, "syncGmail").mockImplementation(async options => { budgets.push(options.budgetMs!); return { result, fetched: 0, capped: false, parseErrors: [] }; });
    const reporter = () => ({ update: () => undefined, complete: () => undefined, fail: () => undefined });
    await syncGmailAccounts({ accounts: [target("one"), target("two"), target("three")], signal: new AbortController().signal,
      pipeline: () => ({ now: new Date(), extractor: async () => ({ ok: false, skipped: true, reason: "unused" }) }), reporter, publish: () => true, totalBudgetMs: 90000 });
    expect(budgets[0]).toBe(30000);
    expect(budgets[1]).toBeGreaterThan(30000 - 1); // shares what is left of 90 s over the two accounts still to run
    expect(budgets[1]).toBeLessThanOrEqual(45000);
    expect(budgets[2]).toBeGreaterThan(45000 - 1);
    expect(budgets[2]).toBeLessThanOrEqual(90000);
  });

  it("defaults to the 240 s sync budget, under the route's 300 s maxDuration", () => {
    expect(service.SYNC_BUDGET_MS).toBe(240000);
  });
});
