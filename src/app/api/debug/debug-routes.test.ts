import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refundOverdueFixture } from "@/lib/claims/test-fixtures";
import { createMemoryCache } from "@/lib/ingestion";
import type { LlmClient, LlmToolRequest } from "@/lib/llm";
import { getState, resetStore } from "@/lib/store";
import { EXTRACTION_NO_KEY_REASON, EXTRACTION_OPT_IN_REASON, runDebugPipeline, type DebugPipelineResult } from "./_lib/pipeline";
import * as claimRoute from "./claim/route";
import * as pipelineRoute from "./pipeline/route";
import * as statusRoute from "./status/route";

const SYNTHETIC_KEY = "sk-ant-synthetic-test-key-do-not-leak";

function edgeCase(name: string): string {
  return readFileSync(new URL(`../../../../tools/playground/edge-cases/${name}`, import.meta.url), "utf8");
}

function postJson(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  resetStore();
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("LLM_MODEL", undefined);
  vi.stubEnv("PT_ENABLE_DEBUG", undefined);
  vi.stubEnv("PAPERTRAIL_REDACT", "on");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/debug/status", () => {
  it("reports whether a key is configured without ever returning it", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", SYNTHETIC_KEY);
    const response = statusRoute.GET();
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain(SYNTHETIC_KEY);
    expect(text).not.toContain("sk-ant");
    expect(JSON.parse(text)).toEqual({ llmConfigured: true, model: "claude-sonnet-5-5" });
  });

  it("reports no key and the configured model", async () => {
    vi.stubEnv("LLM_MODEL", "claude-test-model");
    expect(await statusRoute.GET().json()).toEqual({ llmConfigured: false, model: "claude-test-model" });
  });
});

describe("production guard", () => {
  it("returns 404 from every debug route in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(statusRoute.GET().status).toBe(404);
    expect((await pipelineRoute.POST(postJson("/api/debug/pipeline", { raw: edgeCase("01-plain-order.eml") }))).status).toBe(404);
    const { finding, order } = refundOverdueFixture();
    expect((await claimRoute.POST(postJson("/api/debug/claim", { finding, order }))).status).toBe(404);
  });

  it("serves debug routes in production only when PT_ENABLE_DEBUG=1", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PT_ENABLE_DEBUG", "1");
    expect(statusRoute.GET().status).toBe(200);
  });
});

describe("POST /api/debug/pipeline", () => {
  async function runRoute(body: unknown): Promise<{ status: number; json: DebugPipelineResult & { error?: string } }> {
    const response = await pipelineRoute.POST(postJson("/api/debug/pipeline", body));
    return { status: response.status, json: await response.json() };
  }

  it("returns every stage without calling an LLM when useLlm is off", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { status, json } = await runRoute({ raw: edgeCase("02-order-full-pan.eml"), now: "2026-10-20T12:00:00Z" });
    expect(status).toBe(200);
    expect(json.now).toBe("2026-10-20T12:00:00.000Z");
    expect(json.email.subject).toBe("Your Voltline order #VL-55120 is confirmed");
    expect(json.prefilter.keep).toBe(true);
    expect(json.classification.class).toBe("order");
    expect(json.redaction.redactions.pan).toBe(1);
    expect(json.redaction.text).toContain("[PAN_1]");
    expect(json.redaction.text).not.toContain("4242 4242 4242 4242");
    expect(json.extraction).toEqual({ status: "skipped", reason: EXTRACTION_OPT_IN_REASON });
    expect(json.orders).toEqual([]);
    expect(json.findings).toEqual([]);
    expect(json.audit).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips extraction when the user opts in but no key is configured", async () => {
    const { json } = await runRoute({ raw: edgeCase("01-plain-order.eml"), useLlm: true });
    expect(json.extraction).toEqual({ status: "skipped", reason: EXTRACTION_NO_KEY_REASON });
  });

  it("never extracts a phishing look-alike, even with a key and opt-in", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", SYNTHETIC_KEY);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { json } = await runRoute({ raw: edgeCase("06-phishing-lookalike.eml"), useLlm: true });
    expect(json.classification.class).toBe("not_receipt");
    expect(json.extraction).toEqual({ status: "skipped", reason: "class not_receipt is never extracted" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips extraction for emails the prefilter drops", async () => {
    const { json } = await runRoute({ raw: edgeCase("28-newsletter.eml"), useLlm: true });
    expect(json.prefilter.keep).toBe(false);
    expect(json.extraction.status).toBe("skipped");
  });

  it("rejects invalid input with 400", async () => {
    expect((await pipelineRoute.POST(postJson("/api/debug/pipeline", "{not json"))).status).toBe(400);
    expect((await runRoute({})).status).toBe(400);
    expect((await runRoute({ raw: "" })).status).toBe(400);
    expect((await runRoute({ raw: "x".repeat(200_001) })).status).toBe(400);
    expect((await runRoute({ raw: edgeCase("01-plain-order.eml"), now: "yesterday" })).status).toBe(400);
    expect((await runRoute({ raw: edgeCase("01-plain-order.eml"), useLlm: "yes" })).status).toBe(400);
  });

  it("returns 400 with the parser message for an email without a Date header", async () => {
    const { status, json } = await runRoute({ raw: "From: shop@example.example\nSubject: hi\n\nbody" });
    expect(status).toBe(400);
    expect(json.error).toMatch(/Date header/);
  });
});

describe("runDebugPipeline with a (fake) LLM", () => {
  it("extracts from the redacted email only, audits the call, and matches + runs rules at `now`", async () => {
    const requests: LlmToolRequest[] = [];
    const llm: LlmClient = {
      model: "fake-model",
      async callTool(request) {
        requests.push(request);
        return {
          model: "fake-model",
          text: "",
          usage: { inputTokens: 120, outputTokens: 40 },
          toolInput: {
            fields: {
              merchant: "Voltline Electronics",
              merchantDomain: "voltline.example",
              orderRef: "VL-55120",
              date: "2026-10-02T09:15:00Z",
              currency: "USD",
              lineItems: [{ name: "USB-C Dock", sku: "VL-DOCK-7", qty: 1, unitPrice: 89.99 }],
              totals: { subtotal: 89.99, tax: 7.2, total: 97.19 },
            },
            confidence: { merchant: 0.95, merchantDomain: 0.95, orderRef: 0.95, date: 0.9, currency: 0.9, lineItems: 0.9, totals: 0.9 },
            evidence: { orderRef: "Order number: VL-55120", totals: "Order total: $97.19" },
          },
        };
      },
    };
    const audited: unknown[] = [];
    const result = await runDebugPipeline({
      raw: edgeCase("02-order-full-pan.eml"),
      now: new Date("2026-10-28T12:00:00Z"),
      useLlm: true,
      llmConfigured: true,
      cache: createMemoryCache(),
      llm,
      audit: (event) => audited.push(event),
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].user).not.toContain("4242 4242 4242 4242");
    expect(requests[0].user).toContain("[PAN_1]");
    expect(result.extraction.status).toBe("ok");
    expect(result.audit).toHaveLength(1);
    expect(result.audit[0]).toMatchObject({ type: "llm_call", model: "fake-model", redactedTokenCount: 2 });
    expect(audited).toEqual(result.audit);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({ orderRef: "VL-55120", total: 97.19, currency: "USD", needsReview: false });
    // Ordered Oct 2, default 30-day window from the order date => return by Nov 1; now Oct 28 is within 7 days.
    expect(result.findings.map((finding) => [finding.kind, finding.amountAtStake])).toEqual([["return_deadline", 97.19]]);
  });

  it("reports provider errors without throwing", async () => {
    const llm: LlmClient = {
      model: "fake-model",
      callTool: () => Promise.reject(new Error("synthetic outage")),
    };
    const result = await runDebugPipeline({
      raw: edgeCase("01-plain-order.eml"),
      now: new Date("2026-10-05T12:00:00Z"),
      useLlm: true,
      llmConfigured: true,
      cache: createMemoryCache(),
      llm,
    });
    expect(result.extraction).toEqual({ status: "error", reason: "Error: synthetic outage" });
    expect(result.orders).toEqual([]);
  });
});

describe("POST /api/debug/claim", () => {
  it("drafts a claim whose numbers come from the finding, with copy + mailto hand-off and no network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { finding, order } = refundOverdueFixture();
    const response = await claimRoute.POST(
      postJson("/api/debug/claim", { finding, order, supportEmail: "help@northwind.example" }),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.draft.findingId).toBe(finding.id);
    expect(json.draft.recipient).toBe("help@northwind.example");
    expect(json.draft.recipientVerified).toBe(true);
    expect(json.draft.body).toContain("$113.00");
    expect(json.draft.facts.length).toBeGreaterThan(0);
    expect(json.mailto).toMatch(/^mailto:help@northwind\.example\?subject=/);
    expect(json.clipboard).toContain(json.draft.subject);
    expect(json.rephrase).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps the template draft when rephrase is requested without a key", async () => {
    const { finding, order } = refundOverdueFixture();
    const json = await (await claimRoute.POST(postJson("/api/debug/claim", { finding, order, rephrase: true }))).json();
    expect(json.rephrase.rephrased).toBe(false);
    expect(json.rephrase.reason).toMatch(/ANTHROPIC_API_KEY/);
    expect(getState().audit).toEqual([]);
  });

  it("returns 422 when the finding belongs to another order", async () => {
    const { finding, order } = refundOverdueFixture();
    const response = await claimRoute.POST(postJson("/api/debug/claim", { finding, order: { ...order, id: "other" } }));
    expect(response.status).toBe(422);
    expect((await response.json()).details).toEqual({ reason: "order_mismatch" });
  });

  it("rejects invalid input with 400", async () => {
    const { finding, order } = refundOverdueFixture();
    expect((await claimRoute.POST(postJson("/api/debug/claim", "nope"))).status).toBe(400);
    expect((await claimRoute.POST(postJson("/api/debug/claim", { finding }))).status).toBe(400);
    expect((await claimRoute.POST(postJson("/api/debug/claim", { finding, order, supportEmail: "not-an-email" }))).status).toBe(400);
  });
});
