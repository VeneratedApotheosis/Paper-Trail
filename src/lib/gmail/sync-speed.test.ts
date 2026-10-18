import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtractionSchema, type RawEmail } from "@/lib/contracts";
import { createSeedExtractor, seedInbox, seedPriceFeed } from "@/lib/demo/seed";
import { runPipeline, type PipelineExtractor } from "@/lib/pipeline/run";
import { createRequestPacer, GMAIL_FETCH_BURST, GMAIL_FETCH_PER_SECOND, GmailError } from "./client";
import { decodeGmailMessage } from "./decode";
import type { GmailWorkProgress } from "./progress";
import { syncGmail } from "./service";

const now = new Date("2026-10-17T00:00:00Z");
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); });

function gmailMessage(id: string, text: string, internalDate = "1790812800000") {
  return { id, internalDate, payload: { mimeType: "text/plain", headers: [
    { name: "From", value: "orders@synthetic.example" }, { name: "Subject", value: `Order confirmation #${id}` },
  ], body: { data: Buffer.from(text).toString("base64url") } } };
}
function orderMessage(id: string) { return gmailMessage(id, `Thanks for your order #${id}. Order total: $40.00.`); }

/** Fake Gmail: `getMs` of simulated latency per full-message get; tracks concurrent gets. */
function fakeGmail(ids: string[], options: { getMs?: number; respond?: (id: string) => Response | Promise<Response> } = {}) {
  const state = { inFlight: 0, maxInFlight: 0, gets: 0 };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/messages")) return Response.json({ messages: ids.map((id) => ({ id })) });
    const id = decodeURIComponent(path.split("/").at(-1)!);
    state.gets += 1; state.inFlight += 1; state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    try {
      await delay(options.getMs ?? 0);
      return options.respond ? await options.respond(id) : Response.json(orderMessage(id));
    } finally { state.inFlight -= 1; }
  });
  return { fetcher, state };
}

function extractionFor(redacted: { id: string }, className: string) {
  return ExtractionSchema.parse({ emailId: redacted.id, class: className,
    fields: { merchant: "Synthetic Store", merchantDomain: "synthetic.example", orderRef: redacted.id, date: "2026-10-01",
      currency: "USD", totals: { total: 40 }, lineItems: [{ name: "Rain shell", qty: 1, unitPrice: 40 }] },
    confidence: { merchant: 0.95, orderRef: 0.95, totals: 0.95, date: 0.95, currency: 0.95 },
    evidence: { totals: "Order total: $40.00" }, confMin: 0.95, model: "synthetic-test", cached: false });
}
/** Fake LLM: `llmMs` of simulated latency per call; tracks concurrent calls. */
function fakeLlm(llmMs: number) {
  const state = { inFlight: 0, maxInFlight: 0, calls: 0, firstCallAt: null as number | null };
  const extractor: PipelineExtractor = async (redacted, classification) => {
    state.calls += 1; state.inFlight += 1; state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    state.firstCallAt ??= Date.now();
    try {
      await delay(llmMs);
      return { ok: true, extraction: extractionFor(redacted, classification.class) };
    } finally { state.inFlight -= 1; }
  };
  return { extractor, state };
}

/** Runs a promise on the fake clock and reports the simulated elapsed milliseconds (25 ms resolution). */
async function onFakeClock<T>(start: () => Promise<T>): Promise<{ value: T; elapsedMs: number }> {
  const began = Date.now();
  let settled = false;
  const promise = start().finally(() => { settled = true; });
  promise.catch(() => undefined);
  while (!settled) await vi.advanceTimersByTimeAsync(25);
  return { value: await promise, elapsedMs: Date.now() - began };
}

const makeIds = (count: number) => Array.from({ length: count }, (_, i) => `m${i}`);

describe("overlapping fetch and analysis", () => {
  it("finishes in about max(fetch, analysis), not their sum, and starts analysis before fetching ends", async () => {
    const ids = makeIds(20);
    const { fetcher } = fakeGmail(ids, { getMs: 300 });
    const llm = fakeLlm(3000);
    const progress: Array<{ at: number; value: GmailWorkProgress }> = [];
    const { value, elapsedMs } = await onFakeClock(() => syncGmail({
      accessToken: async () => "synthetic", fetcher, audit: vi.fn(),
      onProgress: (value) => progress.push({ at: Date.now(), value }),
      pipeline: { now, extractor: llm.extractor },
    }));
    expect(value.result.orders).toHaveLength(20);
    const processingAt = progress.find((entry) => entry.value.stage === "processing")!.at - now.getTime();
    const firstLlmAt = llm.state.firstCallAt! - now.getTime();
    expect(firstLlmAt).toBeLessThan(1000);
    expect(firstLlmAt).toBeLessThan(processingAt);
    // 20 emails x 3 s / 4 slots = 15 s of analysis; fetching (burst, then 1.4/s) ends ~7 s in. Sequential would be fetch + 60 s.
    const analysisMs = (20 * 3000) / 4;
    expect(elapsedMs).toBeLessThan(analysisMs + 1500);
    expect(elapsedMs).toBeLessThan(processingAt + analysisMs - 3000);
    expect(elapsedMs).toBeGreaterThanOrEqual(analysisMs);
  });

  it("caps analysis at 4 in flight (default) and Gmail gets at 2, and uses both", async () => {
    const { fetcher, state: gmail } = fakeGmail(makeIds(12), { getMs: 100 });
    const llm = fakeLlm(2000);
    await onFakeClock(() => syncGmail({ accessToken: async () => "synthetic", fetcher, audit: vi.fn(),
      pipeline: { now, extractor: llm.extractor } }));
    expect(llm.state.calls).toBe(12);
    expect(llm.state.maxInFlight).toBe(4);
    expect(gmail.maxInFlight).toBe(2);
  });

  it("honors a configured extraction concurrency", async () => {
    const { fetcher } = fakeGmail(makeIds(9), { getMs: 10 });
    const llm = fakeLlm(500);
    await onFakeClock(() => syncGmail({ accessToken: async () => "synthetic", fetcher, audit: vi.fn(),
      pipeline: { now, extractor: llm.extractor, extractConcurrency: 3 } }));
    expect(llm.state.maxInFlight).toBe(3);
  });

  it("is bounded by analysis when fetching is faster and by the quota pacing when analysis is faster", async () => {
    const slowLlm = fakeLlm(4000);
    const a = await onFakeClock(() => syncGmail({ accessToken: async () => "synthetic", fetcher: fakeGmail(makeIds(8), { getMs: 50 }).fetcher,
      audit: vi.fn(), pipeline: { now, extractor: slowLlm.extractor } }));
    expect(a.elapsedMs).toBeLessThan(8 * 4000 / 4 + 500);
    // Cached re-sync: instant analysis, so time is the paced fetch: burst of 10, then 1.4/s.
    const cachedLlm = fakeLlm(0);
    const b = await onFakeClock(() => syncGmail({ accessToken: async () => "synthetic", fetcher: fakeGmail(makeIds(50), { getMs: 300 }).fetcher,
      audit: vi.fn(), pipeline: { now, extractor: cachedLlm.extractor } }));
    const pacedMs = ((50 - GMAIL_FETCH_BURST) / GMAIL_FETCH_PER_SECOND) * 1000;
    expect(b.elapsedMs).toBeGreaterThanOrEqual(pacedMs);
    expect(b.elapsedMs).toBeLessThan(pacedMs + 1500);
  });
});

describe("Gmail request pacing", () => {
  it("never sleeps while under the burst budget, then paces to the sustained rate", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    let clock = 0;
    const acquire = createRequestPacer({ burst: 10, perSecond: 1.4, sleep, now: () => clock });
    for (let i = 0; i < 10; i++) await acquire();
    expect(sleep).not.toHaveBeenCalled();
    await acquire();
    expect(sleep).toHaveBeenLastCalledWith(Math.ceil(1000 / 1.4));
    await acquire(); // a second caller reserved right behind the first waits for its own token
    expect(sleep).toHaveBeenLastCalledWith(Math.ceil(2000 / 1.4));
    // After the clock catches up the deficit is repaid and the bucket refills (never beyond the burst size).
    clock += 60_000;
    sleep.mockClear();
    for (let i = 0; i < 10; i++) await acquire();
    expect(sleep).not.toHaveBeenCalled();
    await acquire();
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("stays below the per-minute quota (6,000 units / 60 per full get) over any 60 s window", () => {
    expect(GMAIL_FETCH_BURST + 60 * GMAIL_FETCH_PER_SECOND).toBeLessThanOrEqual(100);
  });

  it("does not call pace at all for a small sync, and paces only the overflow of a large one", async () => {
    const pace = vi.fn().mockResolvedValue(undefined);
    const llm = fakeLlm(0);
    await onFakeClock(() => syncGmail({ accessToken: async () => "synthetic", fetcher: fakeGmail(makeIds(10)).fetcher, audit: vi.fn(),
      pace, pipeline: { now, extractor: llm.extractor } }));
    expect(pace).not.toHaveBeenCalled();
    await onFakeClock(() => syncGmail({ accessToken: async () => "synthetic", fetcher: fakeGmail(makeIds(25)).fetcher, audit: vi.fn(),
      pace, pipeline: { now, extractor: llm.extractor } }));
    expect(pace).toHaveBeenCalledTimes(15);
  });

  it("backs off on 429 with Retry-After and then completes without losing a message", async () => {
    let first = true;
    const { fetcher } = fakeGmail(makeIds(3), { respond: (id) => {
      if (id === "m1" && first) { first = false; return new Response(null, { status: 429, headers: { "retry-after": "2" } }); }
      return Response.json(orderMessage(id));
    } });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const llm = fakeLlm(0);
    const { value } = await onFakeClock(() => syncGmail({ accessToken: async () => "synthetic", fetcher, audit: vi.fn(), sleep,
      pace: async () => {}, pipeline: { now, extractor: llm.extractor } }));
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(value.result.orders).toHaveLength(3);
    expect(llm.state.calls).toBe(3);
  });

  it("surfaces a long Retry-After as a rate-limit error instead of waiting", async () => {
    const { fetcher } = fakeGmail(makeIds(3), { respond: () => new Response(null, { status: 429, headers: { "retry-after": "120" } }) });
    const llm = fakeLlm(0);
    await expect(onFakeClock(() => syncGmail({ accessToken: async () => "synthetic", fetcher, audit: vi.fn(), sleep: async () => {},
      pace: async () => {}, pipeline: { now, extractor: llm.extractor } }))).rejects.toMatchObject({ status: 429, code: "gmail_rate_limited" });
  });
});

describe("progress", () => {
  it("reports real fetched/total/skipped while fetching and one processing step after the last fetch", async () => {
    const ids = makeIds(8);
    const { fetcher } = fakeGmail(ids, { getMs: 200, respond: (id) =>
      id === "m2" ? new Response(null, { status: 404 }) : id === "m5" ? Response.json({ id: "m5", payload: {} }) : Response.json(orderMessage(id)) });
    const llm = fakeLlm(1000);
    const progress: GmailWorkProgress[] = [];
    const { value } = await onFakeClock(() => syncGmail({ accessToken: async () => "synthetic", fetcher, audit: vi.fn(),
      onProgress: (entry) => progress.push(entry), pipeline: { now, extractor: llm.extractor } }));
    expect(progress[0]).toEqual({ stage: "listing", fetched: 0, total: null, skipped: 0 });
    expect(progress[1]).toEqual({ stage: "fetching", fetched: 0, total: 8, skipped: 0 });
    const fetching = progress.filter((entry) => entry.stage === "fetching");
    expect(fetching.map((entry) => entry.fetched)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(fetching.every((entry) => entry.total === 8)).toBe(true);
    expect(fetching.map((entry) => entry.skipped)).toEqual([...fetching.map((entry) => entry.skipped)].sort());
    expect(progress.filter((entry) => entry.stage === "processing")).toEqual([{ stage: "processing", fetched: 8, total: 8, skipped: 2 }]);
    expect(progress.at(-1)?.stage).toBe("processing");
    expect(value.parseErrors).toEqual([
      { id: "m2", reason: "message_unavailable" }, { id: "m5", reason: "unsupported_or_malformed_message" },
    ]);
    expect(value.result.orders).toHaveLength(6);
    expect(value.fetched).toBe(8);
  });
});

describe("equivalence with the sequential pipeline on the synthetic seed", () => {
  const seedEmails = seedInbox.emails.slice(0, 50);
  const toGmail = (email: RawEmail) => ({ ...gmailMessage(email.id, email.text, String(Date.parse(email.date))), payload: {
    mimeType: "text/plain", body: { data: Buffer.from(email.text).toString("base64url") }, headers: [
      { name: "From", value: email.from }, ...(email.to ? [{ name: "To", value: email.to }] : []), { name: "Subject", value: email.subject },
    ] } });

  it("produces identical orders, findings, review queue and stats whatever order fetches and LLM calls finish in", async () => {
    const decoded = seedEmails.map((email) => decodeGmailMessage(toGmail(email)));
    const sequential = await runPipeline(decoded, { now, priceFeed: seedPriceFeed, applyPrefilter: true, sourceLabel: "gmail",
      extractConcurrency: 1, extractor: createSeedExtractor({ seedCache: null }) });
    expect(sequential.findings.length).toBeGreaterThan(0);

    const messages = new Map(seedEmails.map((email, index) => [email.id, { message: toGmail(email), index }]));
    const gold = createSeedExtractor({ seedCache: null });
    // Fetch and LLM latencies deliberately reversed against input order so completion order scrambles.
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/messages")) return Response.json({ messages: seedEmails.map((email) => ({ id: email.id })) });
      const entry = messages.get(decodeURIComponent(path.split("/").at(-1)!))!;
      await delay(((seedEmails.length - entry.index) % 5) * 40);
      return Response.json(entry.message);
    });
    let maxInFlight = 0, inFlight = 0;
    const extractor: PipelineExtractor = async (redacted, classification, raw) => {
      inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
      try { await delay(((redacted.id.length * 7 + raw.subject.length) % 9) * 300); return await gold(redacted, classification, raw); }
      finally { inFlight -= 1; }
    };
    const { value } = await onFakeClock(() => syncGmail({ accessToken: async () => "synthetic", fetcher, audit: vi.fn(),
      pace: async () => {}, pipeline: { now, priceFeed: seedPriceFeed, extractor } }));
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(value.result).toEqual(sequential);
    expect(value.parseErrors).toEqual([]);
  });
});

describe("failure and cancellation", () => {
  it("aborts mid-way without publishing a result or making further calls", async () => {
    const controller = new AbortController();
    const { fetcher, state } = fakeGmail(makeIds(30), { getMs: 100 });
    const llm = fakeLlm(1000);
    const progress: GmailWorkProgress[] = [];
    const outcome = onFakeClock(() => syncGmail({ accessToken: async () => "synthetic", fetcher, audit: vi.fn(), signal: controller.signal,
      onProgress: (entry) => { progress.push(entry); if (entry.stage === "fetching" && entry.fetched === 4) controller.abort(); },
      pipeline: { now, extractor: llm.extractor } }));
    await expect(outcome).rejects.toMatchObject({ name: "AbortError" });
    const gets = state.gets, calls = llm.state.calls;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(state.gets).toBe(gets);
    expect(llm.state.calls).toBe(calls);
    expect(gets).toBeLessThan(30);
    expect(progress.some((entry) => entry.stage === "processing")).toBe(false);
  });

  it("times out at the budget while analysis is still running and starts no new LLM calls afterwards", async () => {
    const { fetcher } = fakeGmail(makeIds(20), { getMs: 100 });
    const llm = fakeLlm(5000);
    const outcome = onFakeClock(() => syncGmail({ accessToken: async () => "synthetic", fetcher, audit: vi.fn(), budgetMs: 8000,
      pipeline: { now, extractor: llm.extractor } }));
    await expect(outcome).rejects.toMatchObject({ status: 504, code: "sync_timeout" });
    const calls = llm.state.calls;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(llm.state.calls).toBe(calls);
    expect(calls).toBeLessThan(20);
  });

  it("fails fast on an extraction outage: no sync result, and no new provider calls once it is known", async () => {
    const { fetcher, state } = fakeGmail(makeIds(30), { getMs: 50 });
    const extractor = vi.fn<PipelineExtractor>().mockImplementation(async () => { await delay(200); throw new Error("synthetic outage"); });
    await expect(onFakeClock(() => syncGmail({ accessToken: async () => "synthetic", fetcher, audit: vi.fn(),
      pipeline: { now, extractor } }))).rejects.toBeInstanceOf(GmailError);
    expect(extractor.mock.calls.length).toBeLessThanOrEqual(4);
    expect(state.gets).toBeLessThan(30);
  });

  it("fails the whole sync on a transient fetch failure even when other fetches succeeded", async () => {
    const { fetcher } = fakeGmail(makeIds(6), { getMs: 50, respond: (id) => id === "m3" ? new Response(null, { status: 503 }) : Response.json(orderMessage(id)) });
    const llm = fakeLlm(100);
    await expect(onFakeClock(() => syncGmail({ accessToken: async () => "synthetic", fetcher, audit: vi.fn(), sleep: async () => {},
      pace: async () => {}, pipeline: { now, extractor: llm.extractor } }))).rejects.toMatchObject({ code: "gmail_unavailable" });
  });
});
