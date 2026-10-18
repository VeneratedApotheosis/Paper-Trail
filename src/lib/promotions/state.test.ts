import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RawEmail } from "@/lib/contracts";
import { parseEml, runUploadPipeline } from "@/lib/demo";
import { LlmHttpError, type LlmClient, type LlmToolRequest } from "@/lib/llm";
import { createSyncCollector } from "@/lib/quality/collector";
import { NOW, fakeLlm, order, unavailableLlm } from "@/lib/quality/test-helpers";
import { getState, resetStore, setPipelineResult } from "@/lib/store";
import { PROMOTION_TOOL_NAME } from "./llm";
import { enrichPromotions, listPromotions, promotionCandidates, promotionLlmLimit, recordSyncPromotions } from "./state";

/** Synthetic marketing emails: fictional stores on reserved .example domains. Clock: NOW = 2026-10-17T12:00Z. */
const UTC = { utcOffsetMinutes: () => 0 };

function promo(id: string, subject: string, text: string, extra: Partial<RawEmail> = {}): RawEmail {
  return {
    id, from: '"Lumen Beauty" <offers@e.lumenbeauty.example>', to: "sam.rivera@mail.example", subject,
    date: "2026-10-17T10:00:00.000Z", text: `${text}\nUnsubscribe from promotional email any time.`, ...extra,
  };
}
const ULTA_LIKE = promo("ulta", "Ends tonight! Get $10 off your $40 order when you pick it up at the store", "Show this email in store. Shop now.");
const FALL20 = promo("fall20", "Fall into savings", "Take 20% off everything. Use code FALL20 at checkout. Sale ends Oct 25.", { date: "2026-10-16T09:00:00.000Z" });
const CHINESE = promo("zh", "秋季限時優惠", "輸入折扣碼 AUTUMN88 享全館8折，10月20日截止。", { from: '"小月商店" <hello@shop.xiaoyue.example>' });
const NEWSLETTER = promo("news", "Five ways to layer textures", "This month in the Journal.", { from: '"The Oakhaven Journal" <journal@oakhaven.example>' });

async function publish(emails: readonly RawEmail[], options: Parameters<typeof recordSyncPromotions>[1] = {}, source: "upload" | "gmail" = "upload", accountId?: string) {
  const collector = createSyncCollector({ source, ...(accountId ? { accountId } : {}), clock: () => NOW });
  const result = await runUploadPipeline(emails.map((email) => (accountId ? { ...email, sourceAccount: accountId } : email)), {
    cache: { get: () => undefined, set: () => undefined }, now: NOW, llm: fakeLlm(), observer: collector.observe, onUsage: collector.recordUsage,
  });
  setPipelineResult("upload", NOW.toISOString(), result);
  const collected = collector.finish(result);
  const recorded = recordSyncPromotions(collected, { rules: UTC, now: () => NOW, ...options });
  await recorded.enrichment;
  return { collected, recorded, result };
}

/** A model that answers promotion requests with a canned tool input (or whatever `answer` returns for the prompt). */
function promoLlm(answer: (request: LlmToolRequest, call: number) => unknown, model = "fake-promo-model"): LlmClient & { requests: LlmToolRequest[] } {
  const requests: LlmToolRequest[] = [];
  return {
    model, requests,
    async callTool(request) {
      requests.push(request);
      return { toolInput: answer(request, requests.length), text: "", model, usage: { inputTokens: 80, outputTokens: 40 } };
    },
  };
}
const claudeAnswer = (extra: Record<string, unknown> = {}) => ({
  headline: "20% off everything", discount: { kind: "percent", value: 20, currency: null, minSpend: null },
  codes: ["FALL20"], expiresAt: "2026-10-25", channel: "online", confidence: 0.93, ...extra,
});

beforeEach(() => resetStore());
afterEach(() => resetStore());

describe("promotionCandidates", () => {
  it("lists marketing offers (rules), prefiltered promos and Chinese promos, and skips everything else", async () => {
    const receiptWithFooter = order("rcpt", "NW-77", { text: "Thanks for your order! Order #NW-77\nTrail Rain Shell  1  $120.00\nOrder total: $120.00\nGet 20% off your next order with code THANKS20. Ends Oct 31." });
    const shipping = order("ship", "NW-78", { subject: "Your order #NW-78 has shipped", text: "Your order has shipped. Tracking number: 1Z999. Use code SHIPPED5 for 5% off." });
    const phishing = promo("phish", "Verify your account now", "Urgent: verify your card details. Save 50% off with code HURRY.", { from: '"Lumen Beauty" <offers@lumen-secure-login.example>' });
    const collector = createSyncCollector({ source: "upload" });
    const result = await runUploadPipeline([ULTA_LIKE, FALL20, CHINESE, NEWSLETTER, receiptWithFooter, shipping, phishing], {
      cache: { get: () => undefined, set: () => undefined }, now: NOW, llm: fakeLlm(), observer: collector.observe,
    });
    const found = promotionCandidates(collector.finish(result).texts, UTC).map(({ promotion }) => promotion);
    expect(found.map((promotion) => promotion.id).sort()).toEqual(["fall20", "ulta", "zh"]);
    const byId = Object.fromEntries(found.map((promotion) => [promotion.id, promotion]));
    expect(byId.ulta).toMatchObject({ headline: "$10 off a $40 pickup order", expiresAt: "2026-10-17T23:59:00.000Z", channel: "in_store", source: "rules", store: "Lumen Beauty", storeDomain: "lumenbeauty.example" });
    expect(byId.fall20).toMatchObject({ codes: ["FALL20"], expiresAt: "2026-10-25T23:59:00.000Z" });
    expect(byId.zh).toMatchObject({ codes: ["AUTUMN88"], store: "小月商店", discount: { kind: "percent", value: 20 }, expiresAt: "2026-10-20T23:59:00.000Z" });
    expect(result.orders.map((entry) => entry.orderRef).sort()).toEqual(["NW-77", "NW-78"]); // the receipt with a promo footer stays a receipt
  });
});

describe("recordSyncPromotions without Claude", () => {
  it("is rules only with PROMO_LLM_LIMIT=0 and makes no call", async () => {
    const llm = promoLlm(() => claudeAnswer());
    const { recorded } = await publish([ULTA_LIKE, FALL20], { llm, limit: 0 });
    expect(recorded.recorded).toBe(2);
    expect(llm.requests).toHaveLength(0);
    expect(listPromotions({ now: NOW }).promotions.map((promotion) => promotion.source)).toEqual(["rules", "rules"]);
    expect(getState().audit.filter((entry) => entry.type === "llm_call")).toHaveLength(0);
  });

  it("keeps the rules' reading when no API key is configured", async () => {
    await publish([FALL20], { llm: unavailableLlm });
    const [promotion] = listPromotions({ now: NOW }).promotions;
    expect(promotion).toMatchObject({ source: "rules", codes: ["FALL20"] });
    expect(getState().audit.filter((entry) => entry.type === "llm_call")).toHaveLength(0);
    expect(listPromotions({ now: NOW }).enriching).toBe(false);
  });

  it("parses PROMO_LLM_LIMIT", () => {
    expect(promotionLlmLimit(undefined)).toBe(20);
    expect(promotionLlmLimit("")).toBe(20);
    expect(promotionLlmLimit("0")).toBe(0);
    expect(promotionLlmLimit("5")).toBe(5);
    expect(promotionLlmLimit("-1")).toBe(20);
    expect(promotionLlmLimit("many")).toBe(20);
  });
});

describe("recordSyncPromotions with Claude", () => {
  it("takes Claude's validated reading, audits the call and never counts it as owed", async () => {
    const llm = promoLlm(() => claudeAnswer());
    await publish([FALL20], { llm });
    const [promotion] = listPromotions({ now: NOW }).promotions;
    expect(promotion).toMatchObject({ source: "llm", headline: "20% off everything", codes: ["FALL20"], channel: "online", confidence: 0.93, expiresAt: "2026-10-25T23:59:00.000Z" });
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0].tool.name).toBe(PROMOTION_TOOL_NAME);
    expect(llm.requests[0].user).toContain("Email date: 2026-10-16T09:00:00.000Z");
    const calls = getState().audit.filter((entry) => entry.type === "llm_call");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: "fake-promo-model", detail: "Read promotion details — email fall20 (80 input / 40 output tokens)" });
    expect(JSON.stringify(calls)).not.toContain("FALL20");
    expect(getState().findings).toEqual([]);
  });

  it("drops an invented code and an amount that is not in the email", async () => {
    const llm = promoLlm(() => claudeAnswer({ codes: ["FALL20", "FREE100"], discount: { kind: "amount", value: 99, currency: "USD", minSpend: 300 } }));
    await publish([FALL20], { llm });
    const [promotion] = listPromotions({ now: NOW }).promotions;
    expect(promotion.codes).toEqual(["FALL20"]);
    expect(promotion.discount).toMatchObject({ kind: "amount", value: null, minSpend: null });
  });

  it("retries once on an invalid answer, then keeps the rules' reading", async () => {
    const llm = promoLlm(() => ({ headline: "", codes: "FALL20" }));
    await publish([FALL20], { llm });
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[1].user).toContain("Your previous answer was invalid");
    const [promotion] = listPromotions({ now: NOW }).promotions;
    expect(promotion).toMatchObject({ source: "rules", codes: ["FALL20"] });
    expect(getState().audit.filter((entry) => entry.type === "llm_call")).toHaveLength(2);
  });

  it("recovers when the retry is valid", async () => {
    const llm = promoLlm((_request, call) => (call === 1 ? { nope: true } : claudeAnswer({ headline: "Take 20% off" })));
    await publish([FALL20], { llm });
    expect(listPromotions({ now: NOW }).promotions[0]).toMatchObject({ source: "llm", headline: "Take 20% off" });
    expect(llm.requests).toHaveLength(2);
  });

  it("audits a provider error and keeps the rules' reading", async () => {
    const llm: LlmClient = { model: "fake-promo-model", async callTool() { throw new LlmHttpError(529, "overloaded_error"); } };
    await publish([FALL20], { llm });
    expect(listPromotions({ now: NOW }).promotions[0].source).toBe("rules");
    const calls = getState().audit.filter((entry) => entry.type === "llm_call");
    expect(calls).toHaveLength(1);
    expect(calls[0].detail).toContain("failed: http_error");
  });

  it("answers a repeat of the same email from the cache without a call", async () => {
    const llm = promoLlm(() => claudeAnswer());
    await publish([FALL20], { llm });
    await publish([FALL20], { llm });
    expect(llm.requests).toHaveLength(1);
    expect(listPromotions({ now: NOW }).promotions[0].source).toBe("llm");
    expect(getState().audit.filter((entry) => entry.type === "llm_call")).toHaveLength(1);
  });

  it("sends only the newest `limit` promotions to Claude", async () => {
    const emails = [1, 2, 3, 4].map((n) => promo(`p${n}`, `Offer ${n}`, `Take ${n}0% off. Use code CODE${n}X. Ends Oct 30.`, { date: `2026-10-1${n}T09:00:00.000Z`, from: `"Shop ${n}" <deals@shop${n}.example>` }));
    const llm = promoLlm((request) => claudeAnswer({ codes: [], headline: /Offer (\d)/.exec(request.user)![0] }));
    await publish(emails, { llm, limit: 2 });
    expect(llm.requests).toHaveLength(2);
    const bySource = Object.fromEntries(listPromotions({ now: NOW }).promotions.map((promotion) => [promotion.id, promotion.source]));
    expect(bySource).toEqual({ p4: "llm", p3: "llm", p2: "rules", p1: "rules" });
  });

  it("never sends demo-style runs to Claude when useClaude is false", async () => {
    const llm = promoLlm(() => claudeAnswer());
    await publish([FALL20], { llm, useClaude: false });
    expect(llm.requests).toHaveLength(0);
  });

  it("stops quietly when the data was deleted while Claude was reading", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const llm = promoLlm(() => claudeAnswer());
    const slow: LlmClient = { model: llm.model, async callTool(request) { await gate; return llm.callTool(request); } };
    const collector = createSyncCollector({ source: "upload" });
    const result = await runUploadPipeline([FALL20, ULTA_LIKE], { cache: { get: () => undefined, set: () => undefined }, now: NOW, llm: fakeLlm(), observer: collector.observe });
    setPipelineResult("upload", NOW.toISOString(), result);
    const recorded = recordSyncPromotions(collector.finish(result), { rules: UTC, llm: slow });
    expect(listPromotions({ now: NOW }).enriching).toBe(true);
    const { deleteAll } = await import("@/lib/store");
    await deleteAll();
    release();
    await recorded.enrichment;
    expect(listPromotions({ now: NOW }).promotions).toEqual([]);
    expect(getState().audit.filter((entry) => entry.type === "llm_call")).toHaveLength(0);
  });

  it("enrichPromotions with nothing pending does nothing", async () => {
    const llm = promoLlm(() => claudeAnswer());
    await enrichPromotions({ llm });
    expect(llm.requests).toHaveLength(0);
  });
});

describe("listPromotions", () => {
  it("collapses the same offer sent twice and keeps the earliest id", async () => {
    const again = promo("fall20-again", "Fall into savings", "Take 20% off everything. Use code FALL20 at checkout. Sale ends Oct 25.", { date: "2026-10-18T09:00:00.000Z" });
    await publish([FALL20, again], { limit: 0 });
    const { promotions } = listPromotions({ now: NOW });
    expect(promotions).toHaveLength(1);
    expect(promotions[0]).toMatchObject({ id: "fall20", emailIds: ["fall20", "fall20-again"], receivedAt: "2026-10-18T09:00:00.000Z", codes: ["FALL20"] });
  });

  it("keeps same-code offers from different stores and far-apart repeats separate", async () => {
    const other = promo("other", "Fall into savings", "Take 20% off. Use code FALL20.", { from: '"Northwind Outfitters" <deals@northwind.example>' });
    const late = promo("late", "Fall into savings", "Take 20% off everything. Use code FALL20 at checkout. Sale ends Oct 25.", { date: "2026-10-25T09:00:00.000Z" });
    await publish([FALL20, other, late], { limit: 0 });
    expect(listPromotions({ now: NOW, includeExpired: true }).total).toBe(3);
  });

  it("sorts by expiry (soonest first, no end last) and hides expired offers unless asked", async () => {
    const open = promo("open", "Free shipping on orders over $50", "Free shipping on orders over $50, no code needed.", { from: '"Oakhaven Home" <deals@oakhaven.example>' });
    const old = promo("old", "Spring sale", "Take 10% off with code SPRING10. Ends Oct 10.", { from: '"Spring Co" <deals@springco.example>', date: "2026-10-05T09:00:00.000Z" });
    await publish([open, FALL20, ULTA_LIKE, old], { limit: 0 });
    const active = listPromotions({ now: NOW });
    expect(active.promotions.map((promotion) => promotion.id)).toEqual(["ulta", "fall20", "open"]);
    expect(active).toMatchObject({ total: 3, expiredHidden: 1, enriching: false, asOf: NOW.toISOString() });
    const all = listPromotions({ now: NOW, includeExpired: true });
    expect(all.promotions.map((promotion) => promotion.id)).toEqual(["ulta", "fall20", "open", "old"]);
    expect(all.expiredHidden).toBe(0);
  });

  it("judges expiry against the demo's fixed as-of in demo mode", async () => {
    const { result } = await publish([ULTA_LIKE, old("2026-10-05")], { limit: 0 });
    expect(listPromotions({ now: NOW }).promotions.map((promotion) => promotion.id)).toEqual(["ulta"]);
    setPipelineResult("demo", "2026-10-06T12:00:00.000Z", result);
    const demo = listPromotions();
    expect(demo.asOf).toBe("2026-10-06T12:00:00.000Z");
    expect(demo.promotions.map((promotion) => promotion.id)).toEqual(["old", "ulta"]);
  });
});

function old(date: string): RawEmail {
  return promo("old", "Spring sale", "Take 10% off with code SPRING10. Ends Oct 10.", { from: '"Spring Co" <deals@springco.example>', date: `${date}T09:00:00.000Z` });
}

describe("scopes and sources", () => {
  const ids = () => listPromotions({ now: NOW }).promotions.map((promotion) => [promotion.id, promotion.accountId]);

  it("a Gmail run replaces only its own account's promotions; an upload run replaces all", async () => {
    await publish([FALL20], { limit: 0 }, "gmail", "acct-a");
    await publish([ULTA_LIKE], { limit: 0 }, "gmail", "acct-b");
    expect(ids()).toEqual([["ulta", "acct-b"], ["fall20", "acct-a"]]);
    await publish([NEWSLETTER], { limit: 0 }, "gmail", "acct-b");
    expect(ids()).toEqual([["fall20", "acct-a"]]);
    await publish([ULTA_LIKE], { limit: 0 });
    expect(ids()).toEqual([["ulta", undefined]]);
  });

  it("delete-all and a ledger reset clear promotions", async () => {
    await publish([ULTA_LIKE], { limit: 0 });
    const { clearLedger, deleteAll } = await import("@/lib/store");
    clearLedger();
    expect(listPromotions({ now: NOW }).total).toBe(0);
    await publish([ULTA_LIKE], { limit: 0 });
    expect(listPromotions({ now: NOW }).total).toBe(1);
    await deleteAll();
    expect(listPromotions({ now: NOW }).total).toBe(0);
  });
});
describe("the playground promo emails", () => {
  it("become promotions with their codes, offers and ends", async () => {
    const read = (name: string) => parseEml(readFileSync(new URL(`../../../tools/playground/edge-cases/${name}`, import.meta.url), "utf8"));
    await publish(["33-promo-ends-tonight.eml", "34-promo-code-fall20.eml", "35-promo-chinese-code.eml"].map(read), { limit: 0 });
    const byStore = Object.fromEntries(listPromotions({ now: new Date("2026-10-17T12:00:00Z") }).promotions.map((promotion) => [promotion.store, promotion]));
    expect(byStore["Lumen Beauty"]).toMatchObject({ headline: "$10 off a $40 pickup order", channel: "in_store", expiresAt: expect.stringMatching(/^2026-10-1[78]T/) });
    expect(byStore["Northwind Outfitters"]).toMatchObject({ codes: ["FALL20"], discount: { kind: "percent", value: 20 } });
    expect(byStore["小月商店"]).toMatchObject({ codes: ["AUTUMN88"], discount: { kind: "percent", value: 20 } });
  });
});