import type { RawEmail } from "@/lib/contracts";
import { runUploadPipeline } from "@/lib/demo";
import { EXTRACTION_TOOL_NAME } from "@/lib/ingestion/extract-prompt";
import type { LlmClient, LlmToolRequest } from "@/lib/llm";
import { LlmUnavailableError } from "@/lib/llm";
import { beginStoreWork, currentStoreScope, getExcludedMerchants, getExtractionCache, setPipelineResult } from "@/lib/store";
import { createSyncCollector } from "./collector";
import { classOverridesFor } from "./labels";
import { recordSyncQuality } from "./state";

/** Test helpers for quality tracking (#117). Synthetic data only: fictional stores on reserved .example domains. */

export const NOW = new Date("2026-10-17T12:00:00Z");

export function order(id: string, ref: string, extra: Partial<RawEmail> = {}): RawEmail {
  return {
    id, from: '"Northwind Outfitters" <orders@northwind.example>', to: "sam.rivera@mail.example",
    subject: `Order confirmation #${ref}`, date: "2026-10-01T10:00:00.000Z",
    text: `Thanks for your order! Order #${ref}\nTrail Rain Shell  1  $120.00\nOrder total: $120.00\nPaid with Visa ending in 4242. Call 555-012-3456.`,
    ...extra,
  };
}

/** A newsletter the prefilter drops. */
export const NEWSLETTER: RawEmail = {
  id: "news-1", from: '"The Oakhaven Journal" <journal@oakhaven.example>', to: "sam.rivera@mail.example",
  subject: "Five ways to layer textures this autumn", date: "2026-10-10T09:00:00.000Z",
  text: "This month in the Journal: five ways to layer textures. Unsubscribe any time.",
};

/** A promo the classifier calls marketing although it carries an order-like number. */
export const PROMO: RawEmail = {
  id: "promo-1", from: '"Northwind Outfitters" <deals@northwind.example>', to: "sam.rivera@mail.example",
  subject: "Your order #NW-9 is on its way: 40% off the next one",
  date: "2026-10-11T09:00:00.000Z",
  text: "Sale! 40% off everything this weekend only. Shop now and save. Unsubscribe from promotional email any time.",
};

export function extractionInput(ref: string, total = 120) {
  return {
    fields: {
      merchant: "Northwind Outfitters", merchantDomain: "northwind.example", orderRef: ref, date: "2026-10-01", currency: "USD",
      lineItems: [{ name: "Trail Rain Shell", qty: 1, unitPrice: total }], totals: { total },
    },
    confidence: { merchant: 0.95, merchantDomain: 0.95, orderRef: 0.95, date: 0.95, currency: 0.95, lineItems: 0.95, totals: 0.95 },
    evidence: { totals: `Order total: $${total}.00` },
  };
}

export interface FakeLlm extends LlmClient {
  requests: LlmToolRequest[];
}

/** A model that answers every extraction with the order ref found in the prompt and a fixed total. */
export function fakeLlm(model = "fake-model", options: { total?: number; usage?: { inputTokens: number; outputTokens: number } } = {}): FakeLlm {
  const requests: LlmToolRequest[] = [];
  return {
    model, requests,
    async callTool(request) {
      requests.push(request);
      const ref = /#([A-Z0-9-]+)/.exec(request.user)?.[1] ?? "UNKNOWN";
      return { toolInput: extractionInput(ref, options.total ?? 120), text: "", model, usage: options.usage ?? { inputTokens: 100, outputTokens: 50 } };
    },
  };
}

export const unavailableLlm: LlmClient = {
  model: "none",
  async callTool() { throw new LlmUnavailableError("ANTHROPIC_API_KEY is not set"); },
};

export function toolNameOf(request: LlmToolRequest): string {
  return request.tool.name === EXTRACTION_TOOL_NAME ? "extraction" : request.tool.name;
}

/** What POST /api/upload does, in process: pipeline with the quality collector, publish, record. */
export async function publishUpload(emails: readonly RawEmail[], llm: LlmClient) {
  const work = beginStoreWork();
  const collector = createSyncCollector({ source: "upload", clock: () => NOW });
  const result = await runUploadPipeline(emails, {
    cache: getExtractionCache(), now: NOW, audit: work.appendAudit, excludedMerchants: getExcludedMerchants(), llm,
    observer: collector.observe, onUsage: collector.recordUsage, classOverride: classOverridesFor(currentStoreScope()),
  });
  setPipelineResult("upload", NOW.toISOString(), result);
  const report = recordSyncQuality(collector.finish(result));
  return { result, report };
}
