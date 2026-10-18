import { describe, expect, it } from "vitest";
import type { RawEmail } from "@/lib/contracts";
import { createSeedExtractor, seedInbox, seedPriceFeed } from "@/lib/demo/seed";
import {
  DEFAULT_EXTRACT_CONCURRENCY,
  createPipelineRun,
  runPipeline,
  type PipelineAuditEvent,
  type PipelineExtractor,
} from "./run";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Seed gold extractor behind a latency that differs per email (later emails answer sooner) plus injected failures. */
function instrumentedExtractor(audit: PipelineAuditEvent[]) {
  const inner = createSeedExtractor({ seedCache: null, audit: (event) => audit.push(event) });
  const state = { inFlight: 0, maxInFlight: 0, calls: 0, emailIds: [] as string[] };
  const extractor: PipelineExtractor = async (redacted, classification, raw) => {
    const order = seedInbox.emails.findIndex((email) => email.id === raw.id);
    state.calls += 1;
    state.emailIds.push(raw.id);
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    try {
      await sleep(((seedInbox.emails.length - order) % 7));
      if (order % 11 === 3) throw new Error("synthetic provider failure");
      if (order % 13 === 5) return { ok: false, needsReview: true, reason: "synthetic validation failure" };
      if (order % 17 === 7) return { ok: false, skipped: true, reason: "synthetic skip" };
      return await inner(redacted, classification, raw);
    } finally {
      state.inFlight -= 1;
    }
  };
  return { extractor, state };
}

async function run(extractConcurrency: number | undefined) {
  const audit: PipelineAuditEvent[] = [];
  const { extractor, state } = instrumentedExtractor(audit);
  const result = await runPipeline(seedInbox.emails, {
    now: new Date(seedInbox.asOf), priceFeed: seedPriceFeed, extractor, audit: (event) => audit.push(event),
    applyPrefilter: true, extractConcurrency,
  });
  return { result, state, audit };
}

describe("bounded-concurrency extraction", () => {
  it("never exceeds the cap and produces exactly the sequential output (orders, findings, review queue, stats)", async () => {
    const sequential = await run(1);
    expect(sequential.state.maxInFlight).toBe(1);
    expect(sequential.result.reviewQueue.some((item) => item.reason.includes("synthetic provider failure"))).toBe(true);
    expect(sequential.result.reviewQueue.some((item) => item.reason.includes("synthetic validation failure"))).toBe(true);
    expect(sequential.result.findings.length).toBeGreaterThan(0);
    for (const cap of [2, 4, 8, undefined]) {
      const parallel = await run(cap);
      const limit = cap ?? DEFAULT_EXTRACT_CONCURRENCY;
      expect(parallel.state.maxInFlight, `cap ${limit}`).toBeLessThanOrEqual(limit);
      expect(parallel.state.maxInFlight, `cap ${limit} is used`).toBeGreaterThan(1);
      expect(parallel.result, `cap ${limit}`).toEqual(sequential.result);
    }
  });

  it("extracts every email exactly once whatever the order they finish in", async () => {
    const sequential = await run(1);
    const parallel = await run(4);
    // Gold extractions are not LLM calls, so they leave no llm_call audit rows (#40); provenance is in the stats.
    expect(parallel.audit.filter((event) => event.type === "llm_call")).toEqual([]);
    expect(sequential.result.stats.extractionOrigins.gold).toBeGreaterThan(0);
    expect(parallel.result.stats.extractionOrigins).toEqual(sequential.result.stats.extractionOrigins);
    expect(parallel.result.stats).toEqual(sequential.result.stats);
    expect(parallel.result.orders.map((order) => order.id)).toEqual(sequential.result.orders.map((order) => order.id));
    expect(parallel.state.emailIds.length).toBe(sequential.state.emailIds.length);
    expect(new Set(parallel.state.emailIds).size).toBe(parallel.state.emailIds.length);
    expect([...parallel.state.emailIds].sort()).toEqual([...sequential.state.emailIds].sort());    expect(parallel.audit.filter((event) => event.type === "sync_start")).toHaveLength(1);
    expect(parallel.audit.filter((event) => event.type === "sync_complete")).toHaveLength(1);
    expect(parallel.audit[0].type).toBe("sync_start");
    expect(parallel.audit.at(-1)?.type).toBe("sync_complete");
  });

  it("applies backpressure: add() waits while every slot is busy instead of queueing unboundedly", async () => {
    const releases: Array<() => void> = [];
    let started = 0;
    const extractor: PipelineExtractor = (_redacted, _classification, raw) => {
      started += 1;
      return new Promise((resolve) => releases.push(() => resolve({ ok: false, skipped: true, reason: raw.id })));
    };
    const pipeline = createPipelineRun({ now: new Date(seedInbox.asOf), extractor, extractConcurrency: 2 });
    const receipts: RawEmail[] = seedInbox.emails.filter((email) => /order confirmation/i.test(email.subject)).slice(0, 4);
    expect(receipts).toHaveLength(4);
    const accepted = receipts.map(() => false);
    const adds = receipts.map((email, index) => pipeline.add(email).then(() => { accepted[index] = true; }));
    await sleep(10);
    expect(started).toBe(2);
    expect(accepted).toEqual([true, true, false, false]);
    releases.shift()!();
    await sleep(10);
    expect(started).toBe(3);
    expect(accepted).toEqual([true, true, true, false]);
    while (releases.length > 0 || started < 4) {
      releases.shift()?.();
      await sleep(1);
    }
    await Promise.all(adds);
    const result = await pipeline.finish();
    expect(started).toBe(4);
    expect(result.stats.emails).toBe(4);
    expect(result.stats.skipped).toBe(4);
  });

  it("matches runPipeline when emails are streamed one by one", async () => {
    const batch = await run(4);
    const audit: PipelineAuditEvent[] = [];
    const pipeline = createPipelineRun({
      now: new Date(seedInbox.asOf), priceFeed: seedPriceFeed, extractor: instrumentedExtractor(audit).extractor,
      applyPrefilter: true, extractConcurrency: 4,
    });
    for (const email of seedInbox.emails) void pipeline.add(email);
    expect(await pipeline.finish()).toEqual(batch.result);
  });
});
