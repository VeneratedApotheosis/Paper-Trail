import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as audit } from "@/app/api/audit/route";
import { POST as deleteAll } from "@/app/api/delete-all/route";
import { POST as demo } from "@/app/api/demo/route";
import { POST as sync } from "@/app/api/gmail/sync/route";
import { GET as ledger } from "@/app/api/ledger/route";
import { GET as skipped } from "@/app/api/quality/skipped/route";
import { authConfig, SESSION_COOKIE } from "@/lib/auth/config";
import { seal } from "@/lib/auth/crypto";
import { createAuthStore, type AuthStore } from "@/lib/auth/store";
import { EXTRACTION_TOOL_NAME } from "@/lib/ingestion/extract-prompt";
import { createLabelStore, labelStore, setLabelStore, type LabelStore } from "@/lib/quality/labels";
import { fakeLlm, order as uploadedOrder, publishUpload } from "@/lib/quality/test-helpers";
import { getState, resetStore } from "@/lib/store";
import { GET as getOrder } from "./[id]/route";
import { POST as markNotAbout } from "./[id]/emails/[emailId]/not-about-order/route";
import { POST as markNotPurchase } from "./[id]/not-purchase/route";
import { POST as restore } from "./[id]/restore/route";

let db: AuthStore;
let labels: LabelStore;
vi.mock("@/lib/auth/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth/store")>();
  return { ...original, authStore: () => db };
});

interface LedgerJson {
  orders: Array<{ id: string; orderRef: string | null; messageIds: string[]; sources?: string[]; merchant: { name: string } }>;
  findings: Array<{ id: string; orderId: string }>;
  summary: { owedTotal: number; findingCount: number };
}
const json = async <T,>(response: Response) => (await response.json()) as T;
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
const anon = (path: string, method = "POST") => new Request(`http://localhost/api/${path}`, { method });

beforeEach(() => { db = createAuthStore(":memory:"); resetStore(); labels = createLabelStore(":memory:"); setLabelStore(labels); });
afterEach(() => { db.close(); setLabelStore(undefined); resetStore(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function loadDemo() {
  expect((await demo(anon("demo"))).status).toBe(200);
  return json<LedgerJson>(await ledger(anon("ledger", "GET")));
}
const readLedger = async () => json<LedgerJson>(await ledger(anon("ledger", "GET")));

describe("POST /api/orders/:id/not-purchase on the demo ledger", () => {
  it("removes the order and its findings, recomputes owed, labels every email, audits once and lists the emails as skipped", async () => {
    const before = await loadDemo();
    expect(before.summary).toMatchObject({ owedTotal: 1774.23, findingCount: 14 });
    const target = before.orders.find((candidate) => before.findings.some((finding) => finding.orderId === candidate.id))!;
    const findingsOfTarget = before.findings.filter((finding) => finding.orderId === target.id).length;

    const response = await markNotPurchase(anon("x"), idParams(target.id));
    expect(response.status).toBe(200);
    const body = await json<{ emailIds: string[]; removedFindings: number; merchant: string; summary: LedgerJson["summary"] }>(response);
    expect(body).toMatchObject({ orderId: target.id, merchant: target.merchant.name, removedFindings: findingsOfTarget });
    expect(body.emailIds.sort()).toEqual([...target.messageIds].sort());

    const after = await readLedger();
    expect(after.orders.map((candidate) => candidate.id)).not.toContain(target.id);
    expect(after.findings.some((finding) => finding.orderId === target.id)).toBe(false);
    expect(after.summary.findingCount).toBe(before.summary.findingCount - findingsOfTarget);
    expect(after.summary.owedTotal).toBeLessThan(before.summary.owedTotal);
    expect(body.summary).toEqual(after.summary);
    expect((await getOrder(anon("x", "GET"), idParams(target.id))).status).toBe(404);

    for (const emailId of target.messageIds) expect(labels.get("anonymous", emailId)).toMatchObject({ class: "not_receipt", source: "feedback" });
    const auditRows = (await json<{ entries: Array<{ type: string; detail: string }> }>(await audit(anon("audit", "GET")))).entries
      .filter((entry) => entry.detail.includes("as not a purchase"));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({ type: "approval" });

    const list = await json<{ skipped: Array<{ emailId: string; reason: string }> }>(await skipped(anon("quality/skipped", "GET")));
    for (const emailId of target.messageIds) {
      expect(list.skipped.find((entry) => entry.emailId === emailId)).toMatchObject({ reason: "marked_not_purchase" });
    }
  });

  it("keeps it gone when the demo loads again, and after a restart with a fresh store on the same database", async () => {
    const before = await loadDemo();
    const target = before.orders.find((candidate) => before.findings.some((finding) => finding.orderId === candidate.id))!;
    await markNotPurchase(anon("x"), idParams(target.id));
    const marked = await readLedger();

    const reloaded = await loadDemo();
    expect(reloaded.orders.map((candidate) => candidate.id)).not.toContain(target.id);
    expect(reloaded.summary).toEqual(marked.summary);
    // The reload's quality report knows these emails as marked, not as classifier skips.
    const list = await json<{ skipped: Array<{ emailId: string; reason: string }> }>(await skipped(anon("quality/skipped", "GET")));
    expect(list.skipped.filter((entry) => target.messageIds.includes(entry.emailId)).map((entry) => entry.reason)).toEqual(target.messageIds.map(() => "marked_not_purchase"));

    resetStore(); // restart: memory is empty, the labels are still in the database
    const restarted = await loadDemo();
    expect(restarted.orders.map((candidate) => candidate.id)).not.toContain(target.id);
    expect(restarted.summary).toEqual(marked.summary);
  });

  it("restores the order, its findings and the owed total, and removes its labels; a second restore is a 404", async () => {
    const before = await loadDemo();
    const target = before.orders.find((candidate) => before.findings.some((finding) => finding.orderId === candidate.id))!;
    await markNotPurchase(anon("x"), idParams(target.id));
    expect(labels.list("anonymous").length).toBeGreaterThan(0);

    const response = await restore(anon("x"), idParams(target.id));
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ orderId: target.id, summary: { owedTotal: 1774.23, findingCount: 14 } });
    const after = await readLedger();
    expect(after.summary).toMatchObject({ owedTotal: 1774.23, findingCount: 14 });
    expect(after.orders.map((candidate) => candidate.id).sort()).toEqual(before.orders.map((candidate) => candidate.id).sort());
    expect(labels.list("anonymous")).toEqual([]);
    const list = await json<{ skipped: Array<{ emailId: string }> }>(await skipped(anon("quality/skipped", "GET")));
    expect(list.skipped.some((entry) => target.messageIds.includes(entry.emailId))).toBe(false);
    expect(getState().audit.filter((entry) => entry.detail.startsWith("Undid"))).toHaveLength(1);

    expect((await restore(anon("x"), idParams(target.id))).status).toBe(404);
    // And the next demo load counts it again.
    expect((await loadDemo()).summary).toMatchObject({ owedTotal: 1774.23, findingCount: 14 });
  });

  it("keeps a drafted claim and finding status through mark and undo", async () => {
    const before = await loadDemo();
    const finding = before.findings[0];
    const { upsertDraft, setFindingStatus, getState: state } = await import("@/lib/store");
    setFindingStatus(finding.id, "drafted");
    upsertDraft({ id: `draft-${finding.id}`, findingId: finding.id, subject: "Claim", body: "Hello", recipient: "support@example.test", signedName: "Sam" });
    await markNotPurchase(anon("x"), idParams(finding.orderId));
    expect(state().drafts).toEqual([]);
    await restore(anon("x"), idParams(finding.orderId));
    expect(state().findings.find((candidate) => candidate.id === finding.id)).toMatchObject({ status: "drafted" });
    expect(state().drafts.map((draft) => draft.findingId)).toEqual([finding.id]);
  });

  it("rejects an unknown order, a cross-site request, and an empty ledger", async () => {
    expect((await markNotPurchase(anon("x"), idParams("nope"))).status).toBe(409); // nothing loaded yet
    await loadDemo();
    expect((await markNotPurchase(anon("x"), idParams("nope"))).status).toBe(404);
    expect((await restore(anon("x"), idParams("nope"))).status).toBe(404);
    const crossSite = new Request("http://localhost/api/x", { method: "POST", headers: { origin: "http://evil.example" } });
    expect((await markNotPurchase(crossSite, idParams("nope"))).status).toBe(403);
    expect((await restore(crossSite, idParams("nope"))).status).toBe(403);
  });

  it("delete-all clears the labels, so the demo is whole again", async () => {
    const before = await loadDemo();
    const target = before.orders.find((candidate) => before.findings.some((finding) => finding.orderId === candidate.id))!;
    await markNotPurchase(anon("x"), idParams(target.id));
    expect((await deleteAll(anon("delete-all"))).status).toBe(200);
    expect(labels.list("anonymous")).toEqual([]);
    expect((await restore(anon("x"), idParams(target.id))).status).toBe(404);
    expect((await loadDemo()).summary).toMatchObject({ owedTotal: 1774.23, findingCount: 14 });
  });
});

describe("persistence across a restart (label database on disk)", () => {
  it("a new process reading the same database file still skips the marked emails", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pt134-"));
    try {
      vi.stubEnv("DATABASE_URL", join(directory, "papertrail.sqlite"));
      setLabelStore(undefined); // use the file store, opened lazily from DATABASE_URL
      const before = await loadDemo();
      const target = before.orders.find((candidate) => before.findings.some((finding) => finding.orderId === candidate.id))!;
      await markNotPurchase(anon("x"), idParams(target.id));
      setLabelStore(undefined); // the process "exits": the connection closes
      resetStore();
      expect(labelStore().list("anonymous").map((label) => label.emailId).sort()).toEqual([...target.messageIds].sort());
      const restarted = await loadDemo();
      expect(restarted.orders.map((candidate) => candidate.id)).not.toContain(target.id);
    } finally {
      setLabelStore(undefined);
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

// ---- Gmail: two linked accounts, real sync route, fake Gmail + Anthropic over fetch ----

const key = () => authConfig().key;
const tokens = (mailbox: string) =>
  seal({ accessToken: `access-${mailbox}`, refreshToken: `refresh-${mailbox}`, expiresAt: Date.now() + 3600000, mailbox }, key(), "tokens");
function profile(first = "a@example.test", second?: string) {
  const id = db.save(first, tokens(first));
  const linked = second ? db.link(id, second, tokens(second)) : undefined;
  return { id, linked, cookie: seal({ userId: id, expiresAt: Date.now() + 3600000 }, key(), "session") };
}
function req(path: string, cookie: string, body?: unknown) {
  return new Request(`http://localhost:3000/api/${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { origin: "http://localhost:3000", cookie: `${SESSION_COOKIE}=${cookie}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

type Inbox = Array<{ id: string; ref: string }>;
let inboxes: Record<string, Inbox>;
function message(id: string, ref: string) {
  return { id, internalDate: String(Date.parse("2026-09-01T10:00:00Z")), payload: { mimeType: "text/plain", headers: [
    { name: "From", value: "orders@synthetic.example" }, { name: "Subject", value: `Order confirmation #${ref}` },
  ], body: { data: Buffer.from(`Thank you for your order #${ref}. Order total: $40.00.`).toString("base64url") } } };
}
function stubProviders() {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "gmail.googleapis.com") {
      const inbox = inboxes[new Headers(init?.headers).get("authorization")!.replace("Bearer ", "")] ?? [];
      if (url.pathname.endsWith("/messages")) return Response.json({ messages: inbox.map((item) => ({ id: item.id })), resultSizeEstimate: inbox.length });
      const id = url.pathname.split("/").at(-1)!;
      return Response.json(message(id, inbox.find((item) => item.id === id)!.ref));
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
    throw new Error(`Unexpected provider endpoint ${url.hostname}`);
  }));
}
const SHARED = "NW-1";
const gmailLedger = async (cookie: string) => json<LedgerJson>(await ledger(req("ledger", cookie)));
const refsOf = (data: LedgerJson) => data.orders.map((candidate) => candidate.orderRef).sort();
const idOf = (data: LedgerJson, ref: string) => data.orders.find((candidate) => candidate.orderRef === ref)!.id;
const gmailMark = (cookie: string, orderId: string) => markNotPurchase(req("x", cookie, {}), idParams(orderId));
const gmailRestore = (cookie: string, orderId: string) => restore(req("x", cookie, {}), idParams(orderId));

describe("Gmail: the override holds across syncs of any account", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_ENCRYPTION_KEY", "ab".repeat(32)); vi.stubEnv("AUTH_BASE_URL", "http://localhost:3000");
    vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-secret");
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-key"); vi.stubEnv("LLM_MODEL", "synthetic-model");
    inboxes = {
      "access-a@example.test": [{ id: "a1", ref: SHARED }, { id: "a2", ref: "A-ONLY" }],
      "access-b@example.test": [{ id: "b1", ref: SHARED }, { id: "b2", ref: "B-ONLY" }],
    };
    stubProviders();
  });

  it("marks the order both inboxes saw, and neither a full sync nor a one-account sync brings it back", async () => {
    const { cookie, id: a, linked: b } = profile("a@example.test", "b@example.test");
    await sync(req("gmail/sync", cookie, { confirmed: true }));
    const before = await gmailLedger(cookie);
    expect(refsOf(before)).toEqual(["A-ONLY", "B-ONLY", SHARED]);
    const shared = before.orders.find((candidate) => candidate.orderRef === SHARED)!;
    expect(shared.messageIds.sort()).toEqual(["a1", "b1"]);

    const response = await gmailMark(cookie, shared.id);
    expect(response.status).toBe(200);
    expect((await json<{ emailIds: string[] }>(response)).emailIds.sort()).toEqual(["a1", "b1"]);
    expect(refsOf(await gmailLedger(cookie))).toEqual(["A-ONLY", "B-ONLY"]);
    expect(labels.list(a).map((label) => label.emailId).sort()).toEqual(["a1", "b1"]);

    // Syncing only account B rebuilds the ledger from both stored results: the shared order must not come back from A's.
    expect((await sync(req("gmail/sync", cookie, { confirmed: true, accountId: b }))).status).toBe(200);
    expect(refsOf(await gmailLedger(cookie))).toEqual(["A-ONLY", "B-ONLY"]);
    expect((await sync(req("gmail/sync", cookie, { confirmed: true, accountId: a }))).status).toBe(200);
    expect(refsOf(await gmailLedger(cookie))).toEqual(["A-ONLY", "B-ONLY"]);
    expect((await sync(req("gmail/sync", cookie, { confirmed: true }))).status).toBe(200);
    const final = await gmailLedger(cookie);
    expect(refsOf(final)).toEqual(["A-ONLY", "B-ONLY"]);
    // The quality list reports the marked emails by id, once each.
    const list = await json<{ skipped: Array<{ emailId: string; reason: string }> }>(await skipped(req("quality/skipped", cookie)));
    expect(list.skipped.filter((entry) => entry.reason === "marked_not_purchase").map((entry) => entry.emailId).sort()).toEqual(["a1", "b1"]);
  });

  it("holds when dedup moves an email to another order, and after a restart", async () => {
    const { cookie } = profile("a@example.test", "b@example.test");
    await sync(req("gmail/sync", cookie, { confirmed: true }));
    await gmailMark(cookie, idOf(await gmailLedger(cookie), SHARED));
    // The same message ids now carry another order reference (so another order id), as after a different dedup.
    inboxes["access-a@example.test"] = [{ id: "a1", ref: "NW-MOVED" }, { id: "a2", ref: "A-ONLY" }];
    inboxes["access-b@example.test"] = [{ id: "b1", ref: "NW-MOVED" }, { id: "b2", ref: "B-ONLY" }];
    await sync(req("gmail/sync", cookie, { confirmed: true }));
    expect(refsOf(await gmailLedger(cookie))).toEqual(["A-ONLY", "B-ONLY"]);

    resetStore(); // restart: the in-memory store is empty, labels stay
    await sync(req("gmail/sync", cookie, { confirmed: true }));
    expect(refsOf(await gmailLedger(cookie))).toEqual(["A-ONLY", "B-ONLY"]);
  });

  it("undo brings the shared order back with both sources, and it survives a one-account sync", async () => {
    const { cookie, id: a, linked: b } = profile("a@example.test", "b@example.test");
    await sync(req("gmail/sync", cookie, { confirmed: true }));
    const orderId = idOf(await gmailLedger(cookie), SHARED);
    await gmailMark(cookie, orderId);
    expect((await gmailRestore(cookie, orderId)).status).toBe(200);
    const restored = await gmailLedger(cookie);
    expect(refsOf(restored)).toEqual(["A-ONLY", "B-ONLY", SHARED]);
    expect(restored.orders.find((candidate) => candidate.orderRef === SHARED)).toMatchObject({ sources: [a, b].sort() });
    expect(labels.list(a)).toEqual([]);
    // Each stored account result got the order back: a sync of B alone rebuilds the ledger from them.
    await sync(req("gmail/sync", cookie, { confirmed: true, accountId: b }));
    expect(refsOf(await gmailLedger(cookie))).toEqual(["A-ONLY", "B-ONLY", SHARED]);
    // And with the labels gone, a full sync counts it too.
    await sync(req("gmail/sync", cookie, { confirmed: true }));
    expect(refsOf(await gmailLedger(cookie))).toEqual(["A-ONLY", "B-ONLY", SHARED]);
  });

  it("is isolated per profile: another profile keeps its order and cannot undo", async () => {
    const first = profile("a@example.test", "b@example.test");
    const other = profile("c@example.test");
    inboxes["access-c@example.test"] = [{ id: "a1", ref: SHARED }];
    await sync(req("gmail/sync", first.cookie, { confirmed: true }));
    await sync(req("gmail/sync", other.cookie, { confirmed: true }));
    const orderId = idOf(await gmailLedger(first.cookie), SHARED);
    expect(idOf(await gmailLedger(other.cookie), SHARED)).toBe(orderId); // same merchant + ref, different profile
    await gmailMark(first.cookie, orderId);
    expect(refsOf(await gmailLedger(first.cookie))).toEqual(["A-ONLY", "B-ONLY"]);
    expect(refsOf(await gmailLedger(other.cookie))).toEqual([SHARED]);
    expect((await gmailRestore(other.cookie, orderId)).status).toBe(404);
    expect(labels.list(other.id)).toEqual([]);
    // Another profile's sync still counts the same message id.
    await sync(req("gmail/sync", other.cookie, { confirmed: true }));
    expect(refsOf(await gmailLedger(other.cookie))).toEqual([SHARED]);
  });

  it("delete-all clears the labels so the next sync counts the order again", async () => {
    const { cookie, id: a } = profile("a@example.test", "b@example.test");
    await sync(req("gmail/sync", cookie, { confirmed: true }));
    await gmailMark(cookie, idOf(await gmailLedger(cookie), SHARED));
    expect(labels.list(a)).toHaveLength(2);
    expect((await deleteAll(req("delete-all", cookie, {}))).status).toBe(200);
    expect(labels.list(a)).toEqual([]);
    expect((await gmailRestore(cookie, "anything")).status).not.toBe(200);
    expect(getState().orders).toEqual([]);
  });
});

describe("POST /api/orders/:id/emails/:emailId/not-about-order", () => {
  const params = (id: string, emailId: string) => ({ params: Promise.resolve({ id: encodeURIComponent(id), emailId: encodeURIComponent(emailId) }) });
  const SHIPPED_ID = "<ship:1@edge.example>";

  it("removes one email's share, decodes ids with special characters, and refuses the confirmation email", async () => {
    const shipped = uploadedOrder(SHIPPED_ID, "NW-1", { subject: "Your order #NW-1 has shipped", date: "2026-10-03T10:00:00.000Z",
      text: "Order #NW-1 has shipped. Tracking 1Z999. Order total: $120.00" });
    await publishUpload([uploadedOrder("o1", "NW-1"), shipped], fakeLlm());
    const [target] = (await readLedger()).orders;
    expect(target.messageIds.sort()).toEqual([SHIPPED_ID, "o1"].sort());

    expect((await markNotAbout(anon("x"), params(target.id, "o1"))).status).toBe(409);
    expect((await markNotAbout(anon("x"), params(target.id, "nope"))).status).toBe(404);
    const response = await markNotAbout(anon("x"), params(target.id, SHIPPED_ID));
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ orderId: target.id, emailId: SHIPPED_ID, removedOrder: false, summary: { findingCount: expect.any(Number) } });
    expect((await readLedger()).orders[0].messageIds).toEqual(["o1"]);
    expect(labels.list("anonymous").map((label) => label.emailId)).toEqual([SHIPPED_ID]);

    expect((await restore(anon("x"), idParams(target.id))).status).toBe(200);
    expect((await readLedger()).orders[0].messageIds.sort()).toEqual([SHIPPED_ID, "o1"].sort());
    expect(labels.list("anonymous")).toEqual([]);
  });
});
