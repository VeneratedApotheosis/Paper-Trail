import type { EmailClass, ExtractedFields, Extraction, RawEmail } from "@/lib/contracts";
import { matchOrders, type MatchInput } from "@/lib/orders/matcher";
import { defaultRules, runRulesIsolated } from "@/lib/rules";
import type { PipelineResult, PipelineStats } from "./run";

/** Test fixtures for multi-account ledgers (#114). Synthetic data only: fictional merchants on reserved .example domains. */
export const NOW = new Date("2026-10-17T00:00:00Z");
export const JACKET = { name: "Rain Jacket", sku: "NW-RJ-1", qty: 1, unitPrice: 80 };

export function email(id: string, cls: EmailClass, date: string, fields: Partial<ExtractedFields> = {}, sourceAccount?: string): MatchInput {
  const raw: RawEmail = { id, from: '"Northwind Outfitters" <orders@northwind.example>', subject: "Order update", date, text: "",
    ...(sourceAccount ? { sourceAccount } : {}) };
  const extraction: Extraction = {
    emailId: id, class: cls, confidence: {}, evidence: {}, confMin: 0.95, model: "test", cached: false,
    fields: { merchant: "Northwind Outfitters", merchantDomain: "northwind.example", orderRef: "NW-1001", date: date.slice(0, 10),
      currency: "USD", lineItems: [], totals: {}, ...fields },
  };
  return { email: raw, extraction };
}

export function stats(overrides: Partial<PipelineStats> = {}): PipelineStats {
  return { emails: 0, prefilteredOut: 0, classes: {}, extracted: 0, skipped: 0, extractionOrigins: { llm: 0, cache: 0, gold: 0 },
    orders: 0, excludedOrders: 0, findings: 0, needsReview: 0, ...overrides };
}

/** What one account's pipeline run produces from its own emails. */
export function resultOf(inputs: MatchInput[]): PipelineResult {
  const orders = matchOrders(inputs);
  const { findings } = runRulesIsolated(orders, defaultRules, { now: NOW });
  return { orders, findings, reviewQueue: [], stats: stats({ emails: inputs.length, extracted: inputs.length, orders: orders.length,
    findings: findings.length, classes: { order: inputs.length }, extractionOrigins: { llm: inputs.length, cache: 0, gold: 0 } }) };
}

