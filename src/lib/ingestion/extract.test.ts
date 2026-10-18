import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ExtractedFieldNameSchema,
  ExtractionSchema,
  GoldLabelsFileSchema,
  SeedInboxSchema,
  type Classification,
  type EmailClass,
  type RawEmail,
} from "@/lib/contracts";
import { AnthropicLlmClient, FixtureLlmClient, type LlmClient, type LlmToolRequest } from "@/lib/llm";
import { createMemoryCache } from "./cache";
import { computeConfMin, extract, type ExtractionAuditEntry } from "./extract";
import { EXTRACTION_TOOL, EXTRACTION_TOOL_NAME } from "./extract-prompt";
import { LlmError, LlmHttpError, LlmTimeoutError, LlmUnavailableError } from "@/lib/llm";
import { redact } from "./redact";

// Synthetic fixtures only: fictional store on a .example domain, fake customer Sam Rivera.
const RAW: RawEmail = {
  id: "m-nw-1001",
  from: '"Northwind Outfitters" <orders@northwind.example>',
  to: '"Sam Rivera" <sam.rivera@mail.example>',
  subject: "Order confirmation #NW-1001",
  date: "2026-09-01T10:00:00Z",
  text: [
    "Hi Sam, thank you for your order!",
    "Trail Runner x1 $129.99",
    "Order total: $140.39",
    "Paid with card 4111 1111 1111 1111. Questions? Call (555) 012-3456.",
    "Ship to: 123 Maple Street, Springfield, IL 62704",
  ].join("\n"),
};
const EMAIL = redact(RAW);
const ORDER: Classification = { emailId: RAW.id, class: "order", confidence: 0.95, reason: "subject matches order" };
const FIXED_NOW = new Date("2026-09-10T12:00:00Z");

const VALID_TOOL_INPUT = {
  fields: {
    merchant: "Northwind Outfitters",
    merchantDomain: "northwind.example",
    orderRef: "NW-1001",
    date: "2026-09-01",
    currency: "USD",
    lineItems: [{ name: "Trail Runner", sku: null, qty: 1, unitPrice: 129.99 }],
    totals: { subtotal: null, tax: null, shipping: null, discount: null, total: 140.39 },
    last4: null,
    customerName: "Sam",
    eventAmount: null,
    isStoreCredit: false,
  },
  confidence: {
    merchant: 0.97,
    merchantDomain: 0.9,
    orderRef: 0.99,
    date: 0.8,
    currency: 0.75,
    lineItems: 0.93,
    totals: 0.95,
    customerName: 0.85,
  },
  evidence: {
    merchant: "Northwind Outfitters",
    orderRef: "Order confirmation #NW-1001",
    lineItems: "Trail Runner x1 $129.99",
    totals: "Order total: $140.39",
    customerName: "Hi Sam",
  },
};

type ScriptedLlm = LlmClient & { requests: LlmToolRequest[] };

/** Fake LLM that returns the queued tool inputs in order. */
function scriptedLlm(...toolInputs: unknown[]): ScriptedLlm {
  const requests: LlmToolRequest[] = [];
  return {
    model: "fake-model",
    requests,
    async callTool(request) {
      requests.push(request);
      if (requests.length > toolInputs.length) throw new Error("unexpected extra LLM call");
      return { toolInput: toolInputs[requests.length - 1], text: "", usage: { inputTokens: 500, outputTokens: 120 }, model: "fake-model" };
    },
  };
}

function auditLog() {
  const entries: ExtractionAuditEntry[] = [];
  return { entries, audit: (entry: ExtractionAuditEntry) => entries.push(entry) };
}

describe("extract: request content", () => {
  it("sends only the redacted subject/body, sender domain and date through the Anthropic client", async () => {
    const bodies: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      const response = {
        model: "claude-test",
        content: [{ type: "tool_use", id: "t1", name: EXTRACTION_TOOL_NAME, input: VALID_TOOL_INPUT }],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      return new Response(JSON.stringify(response), { status: 200 });
    }) as typeof fetch;
    const llm = new AnthropicLlmClient({ apiKey: "sk-test-not-real", fetchImpl });

    const result = await extract(EMAIL, ORDER, { llm });
    expect(result.ok).toBe(true);

    expect(bodies).toHaveLength(1);
    const body = JSON.parse(bodies[0]);
    const user: string = body.messages[0].content;
    expect(user).toContain("Sender domain: northwind.example");
    expect(user).toContain(`Email date: ${RAW.date}`);
    expect(user).toContain(`Subject: ${EMAIL.subject}`);
    expect(user).toContain(EMAIL.text);
    expect(user).toContain("[PAN_1]");
    expect(user).toContain("[PHONE_1]");
    expect(user).toContain("[ADDRESS_1]");

    for (const secret of ["sam.rivera", "orders@", "4111 1111 1111 1111", "012-3456", "123 Maple Street", EMAIL.textHash]) {
      expect(bodies[0]).not.toContain(secret);
    }
    expect(body.tool_choice).toEqual({ type: "tool", name: EXTRACTION_TOOL_NAME });
    expect(body.system).toMatch(/never compute/i);
  });
});

describe("extract: validation", () => {
  it("returns a schema-valid extraction with confMin over present fields", async () => {
    const llm = scriptedLlm(VALID_TOOL_INPUT);
    const result = await extract(EMAIL, ORDER, { llm });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { extraction } = result;
    expect(ExtractionSchema.parse(extraction)).toEqual(extraction);
    expect(extraction).toMatchObject({ emailId: RAW.id, class: "order", model: "fake-model", cached: false });
    expect(extraction.fields.orderRef).toBe("NW-1001");
    expect(extraction.fields.totals.total).toBe(140.39);
    expect(extraction.confMin).toBe(0.75);
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0].textHash).toBe(EMAIL.textHash);
  });

  it("retries once with the validation error, then succeeds", async () => {
    const invalid = { ...VALID_TOOL_INPUT, fields: { ...VALID_TOOL_INPUT.fields, currency: "dollars" } };
    const llm = scriptedLlm(invalid, VALID_TOOL_INPUT);
    const result = await extract(EMAIL, ORDER, { llm });

    expect(result.ok).toBe(true);
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[0].user).not.toContain("failed validation");
    expect(llm.requests[1].user).toContain("failed validation");
    expect(llm.requests[1].user).toContain("fields.currency");
    expect(llm.requests[1].user).toContain(EMAIL.text);
  });

  it("routes to needs-review after two invalid outputs, keeping the raw output", async () => {
    const invalid = { fields: { merchant: 42 }, confidence: {}, evidence: {} };
    const llm = scriptedLlm(invalid, null);
    const result = await extract(EMAIL, ORDER, { llm });

    expect(llm.requests).toHaveLength(2);
    expect(result).toMatchObject({ ok: false, needsReview: true, raw: null });
    if (result.ok || !("needsReview" in result)) throw new Error("expected needs-review");
    expect(result.reason).toContain(EXTRACTION_TOOL_NAME);
  });

  it("truncates evidence and policyQuote to 200 chars before validation", async () => {
    const longQuote = "Returns accepted within 30 days of delivery. ".repeat(10);
    const input = {
      ...VALID_TOOL_INPUT,
      fields: { ...VALID_TOOL_INPUT.fields, returnWindowDays: 30, policyQuote: longQuote },
      confidence: { ...VALID_TOOL_INPUT.confidence, returnWindowDays: 0.9, policyQuote: 0.9 },
      evidence: { ...VALID_TOOL_INPUT.evidence, returnWindowDays: longQuote },
    };
    const result = await extract(EMAIL, ORDER, { llm: scriptedLlm(input) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.extraction.evidence.returnWindowDays).toHaveLength(200);
    expect(result.extraction.fields.policyQuote).toHaveLength(200);
    expect(longQuote.startsWith(result.extraction.evidence.returnWindowDays ?? "")).toBe(true);
  });
});

describe("extract: skipped classes", () => {
  it.each<EmailClass>(["marketing", "not_receipt"])("never calls the LLM for %s", async (cls) => {
    const llm = scriptedLlm();
    const { entries, audit } = auditLog();
    const result = await extract(EMAIL, { ...ORDER, class: cls }, { llm, audit });

    expect(result).toEqual({ ok: false, skipped: true, reason: `class ${cls} is never extracted` });
    expect(llm.requests).toHaveLength(0);
    expect(entries).toHaveLength(0);
  });
});

describe("extract: cache", () => {
  it("serves repeat emails from the cache by textHash without calling the LLM", async () => {
    const cache = createMemoryCache();
    const { entries, audit } = auditLog();
    const first = await extract(EMAIL, ORDER, { llm: scriptedLlm(VALID_TOOL_INPUT), cache, audit });
    expect(first.ok && first.extraction.cached).toBe(false);

    const duplicate = { ...EMAIL, id: "m-nw-1001-dup" };
    const llm = scriptedLlm();
    const second = await extract(duplicate, { ...ORDER, emailId: duplicate.id }, { llm, cache, audit });

    expect(llm.requests).toHaveLength(0);
    expect(second.ok).toBe(true);
    if (!second.ok || !first.ok) return;
    expect(second.extraction).toEqual({ ...first.extraction, emailId: "m-nw-1001-dup", cached: true });
    expect(entries.map((entry) => entry.cached)).toEqual([false, true]);
    expect(entries[1]).toMatchObject({ inputTokens: 0, outputTokens: 0, emailId: "m-nw-1001-dup", model: "fake-model" });
  });

  it("does not cache needs-review results", async () => {
    const cache = createMemoryCache();
    await extract(EMAIL, ORDER, { llm: scriptedLlm(null, null), cache });
    expect(cache.get(EMAIL.textHash)).toBeUndefined();
  });
});

describe("extract: audit", () => {
  it.each([
    [new LlmHttpError(429, "private-provider"), "http_error"],
    [new LlmHttpError(503, "private-provider"), "http_error"],
    [new LlmTimeoutError(100), "timeout"],
    [new LlmUnavailableError("private-provider"), "unavailable"],
    [new LlmError("private-provider"), "network_error"],
  ])("audits a failed attempt without provider error text (%#)", async (error, errorClass) => {
    const { entries, audit } = auditLog();
    const llm: LlmClient = { model: "synthetic-model", callTool: async () => { throw error; } };
    await expect(extract(EMAIL, ORDER, { llm, audit })).rejects.toBe(error);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ model: "synthetic-model", outcome: "error", errorClass });
    expect(JSON.stringify(entries)).not.toContain("private-provider");
  });
  it("logs every LLM call with model and token counts but no email text", async () => {
    const invalid = { ...VALID_TOOL_INPUT, fields: { ...VALID_TOOL_INPUT.fields, currency: "dollars" } };
    const { entries, audit } = auditLog();
    await extract(EMAIL, ORDER, { llm: scriptedLlm(invalid, VALID_TOOL_INPUT), audit, now: () => FIXED_NOW });

    expect(entries).toEqual([
      { at: FIXED_NOW.toISOString(), actor: "llm", action: "llm_call", model: "fake-model", inputTokens: 500, outputTokens: 120, emailId: RAW.id, cached: false, outcome: "success" },
      { at: FIXED_NOW.toISOString(), actor: "llm", action: "llm_call", model: "fake-model", inputTokens: 500, outputTokens: 120, emailId: RAW.id, cached: false, outcome: "success" },
    ]);
    const serialized = JSON.stringify(entries);
    for (const text of [EMAIL.subject, "Trail Runner", "Northwind", "Sam", "[PAN_1]"]) {
      expect(serialized).not.toContain(text);
    }
  });
});

describe("extract: seeded fixtures (demo mode, no key)", () => {
  it("extracts through FixtureLlmClient keyed by textHash", async () => {
    const llm = new FixtureLlmClient({ [EMAIL.textHash]: VALID_TOOL_INPUT });
    const result = await extract(EMAIL, ORDER, { llm });
    expect(result).toMatchObject({ ok: true, extraction: { model: "fixture", fields: { merchant: "Northwind Outfitters" } } });
  });

  it("extracts every seed inbox email from gold-label fixtures and skips marketing/not_receipt", async () => {
    const inbox = SeedInboxSchema.parse(JSON.parse(readFileSync(join(process.cwd(), "seed", "inbox.json"), "utf8")));
    const gold = GoldLabelsFileSchema.parse(JSON.parse(readFileSync(join(process.cwd(), "seed", "gold_labels.json"), "utf8")));
    const labels = new Map(gold.labels.map((label) => [label.emailId, label]));

    const redacted = inbox.emails.map(redact);
    const fixtures: Record<string, unknown> = {};
    for (const email of redacted) {
      const fields = { merchant: null, orderRef: null, date: null, currency: null, ...labels.get(email.id)?.fields };
      const present = Object.keys(fields).filter((name) => fields[name as keyof typeof fields] != null);
      fixtures[email.textHash] = {
        fields,
        confidence: Object.fromEntries(present.map((name) => [name, 0.9])),
        evidence: {},
      };
    }
    const llm = new FixtureLlmClient(fixtures);

    for (const email of redacted) {
      const label = labels.get(email.id);
      expect(label, email.id).toBeDefined();
      const cls = label?.class ?? "not_receipt";
      const result = await extract(email, { emailId: email.id, class: cls, confidence: 1 }, { llm });
      if (cls === "marketing" || cls === "not_receipt") {
        expect(result, email.id).toMatchObject({ ok: false, skipped: true });
      } else {
        expect(result, email.id).toMatchObject({ ok: true, extraction: { emailId: email.id, class: cls, confMin: 0.9 } });
      }
    }
  });
});

describe("computeConfMin", () => {
  const base = ExtractionSchema.shape.fields.parse({ merchant: null, orderRef: null, date: null, currency: null });

  it("is 0 when nothing was extracted", () => {
    expect(computeConfMin(base, { merchant: 0.9 })).toBe(0);
  });

  it("ignores absent fields and counts a present field without confidence as 0", () => {
    const fields = { ...base, merchant: "Northwind", isStoreCredit: false };
    expect(computeConfMin(fields, { merchant: 0.9, orderRef: 0.1 })).toBe(0.9);
    expect(computeConfMin({ ...fields, orderRef: "NW-1001" }, { merchant: 0.9 })).toBe(0);
  });
});

describe("EXTRACTION_TOOL schema", () => {
  it("mirrors every ExtractedFields field in fields, confidence and evidence", () => {
    const properties = EXTRACTION_TOOL.input_schema.properties as Record<string, { properties: Record<string, unknown> }>;
    const expected = [...ExtractedFieldNameSchema.options].sort();
    expect(Object.keys(properties.fields.properties).sort()).toEqual(expected);
    expect(Object.keys(properties.confidence.properties).sort()).toEqual(expected);
    expect(Object.keys(properties.evidence.properties).sort()).toEqual(expected);
    expect(Object.keys(ExtractionSchema.shape.fields.shape).sort()).toEqual(expected);
  });
});
