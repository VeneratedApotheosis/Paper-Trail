import { expect, it, vi } from "vitest";
import { ExtractionSchema, type RedactedEmail } from "@/lib/contracts";
import { syncGmail, previewGmail } from "./service";
import { GmailError } from "./client";

function fixture(id: string, text = "Thanks for your order #SY-1001. Order total: $40.00. Call (555) 012-3456.") {
  return { id, internalDate: "1790812800000", payload: { mimeType: "text/plain", headers: [
    { name: "From", value: "orders@synthetic.example" }, { name: "Subject", value: "Order confirmation #SY-1001" },
  ], body: { data: Buffer.from(text).toString("base64url") } } };
}
const now = new Date("2026-10-17T00:00:00Z");

it("runs real classification/redaction/matching/rules and reports malformed messages without raw content", async () => {
  const captured: RedactedEmail[] = [];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/messages")) return Response.json({ messages: [{ id: "m1" }, { id: "m2" }] });
    return Response.json(path.endsWith("m1") ? fixture("m1") : { id: "m2", payload: {} });
  });
  const audit = vi.fn(), pace = vi.fn().mockResolvedValue(undefined);
  const onProgress = vi.fn();
  const result = await syncGmail({ accessToken: async () => "synthetic-access", fetcher, audit, pace, onProgress, pipeline: {
    now, audit,
    extractor: async (redacted, classification) => {
      captured.push(redacted);
      return { ok: true, extraction: ExtractionSchema.parse({ emailId: redacted.id, class: classification.class,
        fields: { merchant: "Synthetic Store", merchantDomain: "synthetic.example", orderRef: "SY-1001", date: "2026-10-01",
          currency: "USD", totals: { total: 40 }, lineItems: [{ name: "Rain shell", qty: 1, unitPrice: 40 }] },
        confidence: { merchant: 0.95, orderRef: 0.95, totals: 0.95, date: 0.95, currency: 0.95 },
        evidence: { totals: "Order total: $40.00" }, confMin: 0.95, model: "synthetic-test", cached: false,
      }) };
    },
  } });
  expect(captured).toHaveLength(1);
  expect(captured[0].text).not.toContain("(555) 012-3456");
  expect(captured[0].redactions.phone).toBeGreaterThan(0);
  expect(result.result.orders).toHaveLength(1);
  expect(result.result.orders[0].total).toBe(40);
  expect(result.parseErrors).toEqual([{ id: "m2", reason: "unsupported_or_malformed_message" }]);
  expect(result.result.reviewQueue.some(item => item.emailId === "m2")).toBe(true);
  expect(result.fetched).toBe(2);
  expect(pace).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(result)).not.toContain("(555) 012-3456");
  expect(JSON.stringify(audit.mock.calls)).not.toContain("synthetic-access");
  expect(onProgress.mock.calls.map(([value]) => value)).toEqual([
    { stage: "listing", fetched: 0, total: null, skipped: 0 },
    { stage: "fetching", fetched: 0, total: 2, skipped: 0 },
    { stage: "fetching", fetched: 1, total: 2, skipped: 0 },
    { stage: "fetching", fetched: 2, total: 2, skipped: 1 },
    { stage: "processing", fetched: 2, total: 2, skipped: 1 },
  ]);
});
it("returns preview cap and estimate without fetching bodies", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ resultSizeEstimate: 901 }));
  const preview = await previewGmail({ fetcher, accessToken: async () => "synthetic-access", audit: vi.fn() });
  expect(preview).toMatchObject({ estimatedMessages: 901, messagesToFetch: 300, countIsEstimate: true, windowDays: 90, maxMessages: 300 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not call the pipeline on transient fetch failure or all-malformed messages", async () => {
  const extractor = vi.fn();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async url =>
    new URL(String(url)).pathname.endsWith("/messages") ? Response.json({ messages: [{ id: "m1" }] }) : new Response(null, { status: 503 }));
  await expect(syncGmail({ accessToken: async () => "synthetic", fetcher, sleep: async () => {}, audit: vi.fn(),
    pipeline: { now, extractor }, pace: async () => {} })).rejects.toThrow("gmail_unavailable");
  expect(extractor).not.toHaveBeenCalled();
  fetcher.mockImplementation(async url => new URL(String(url)).pathname.endsWith("/messages")
    ? Response.json({ messages: [{ id: "m1" }] }) : Response.json({ id: "m1" }));
  await expect(syncGmail({ accessToken: async () => "synthetic", fetcher, audit: vi.fn(),
    pipeline: { now, extractor }, pace: async () => {} })).rejects.toBeInstanceOf(GmailError);
  expect(extractor).not.toHaveBeenCalled();
});
it("reports a message removed between list/get and processes the remaining messages", async () => {
  const onProgress = vi.fn();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
    const path = new URL(String(url)).pathname;
    return path.endsWith("/messages") ? Response.json({ messages: [{ id: "gone" }, { id: "m1" }] })
      : path.endsWith("gone") ? new Response(null, { status: 404 }) : Response.json(fixture("m1"));
  });
  const result = await syncGmail({ accessToken: async () => "synthetic", fetcher, audit: vi.fn(), pace: async () => {}, onProgress,
    pipeline: { now, extractor: async () => ({ ok: false, needsReview: true, reason: "synthetic review" }) } });
  expect(result.parseErrors).toEqual([{ id: "gone", reason: "message_unavailable" }]);
  expect(result.result.stats.needsReview).toBe(2);
  expect(onProgress).toHaveBeenLastCalledWith({ stage: "processing", fetched: 2, total: 2, skipped: 1 });
});
it("runs an empty inbox through the pipeline without LLM calls", async () => {
  const onProgress = vi.fn();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({})), extractor = vi.fn();
  const result = await syncGmail({ accessToken: async () => "synthetic", fetcher, audit: vi.fn(),
    pipeline: { now, extractor }, pace: async () => {}, onProgress });
  expect(result.result.stats.emails).toBe(0); expect(result.result.orders).toEqual([]);
  expect(extractor).not.toHaveBeenCalled();
  expect(onProgress).toHaveBeenLastCalledWith({ stage: "processing", fetched: 0, total: 0, skipped: 0 });
});

it("fails an atomic Gmail snapshot on extractor exceptions and stops further provider calls", async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
    const path = new URL(String(url)).pathname;
    return path.endsWith("/messages") ? Response.json({ messages: [{ id: "m1" }, { id: "m2" }] })
      : Response.json(fixture(path.endsWith("m1") ? "m1" : "m2"));
  });
  const extractor = vi.fn().mockRejectedValue(new Error("synthetic provider outage"));
  await expect(syncGmail({ accessToken: async () => "synthetic", fetcher, audit: vi.fn(), pace: async () => {},
    pipeline: { now, extractor } })).rejects.toMatchObject({ status: 503, code: "extraction_unavailable" });
  expect(extractor).toHaveBeenCalledTimes(1);
});
