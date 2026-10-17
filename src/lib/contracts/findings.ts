import { z } from "zod";
import { CurrencySchema, EvidenceSchema } from "./extraction";

/** Mirrors the `finding.kind` enum in src/db/schema/findings.ts. */
export const FindingKindSchema = z.enum([
  "refund_overdue",
  "refund_short",
  "return_deadline",
  "price_drop",
  "rewards_gap",
]);
export type FindingKind = z.infer<typeof FindingKindSchema>;

export const FindingSeveritySchema = z.enum(["low", "medium", "high"]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const FindingStatusSchema = z.enum(["open", "drafted", "resolved", "dismissed"]);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const FindingEvidenceSchema = z.object({
  /** Source email id (RawEmail.id). */
  messageId: z.string(),
  quote: EvidenceSchema,
});
export type FindingEvidence = z.infer<typeof FindingEvidenceSchema>;

/**
 * Rules-engine output (issues #13-#15). All amounts and dates are computed deterministically by rules;
 * the LLM never produces these numbers (AGENTS.md hard rule #4).
 */
export const FindingSchema = z.object({
  /** Deterministic id: `${kind}:${orderId}[:${lineItemId}]` so reruns don't duplicate. */
  id: z.string(),
  kind: FindingKindSchema,
  orderId: z.string(),
  lineItemId: z.string().optional(),
  /** Money the user can get back, in `currency` major units, rounded to cents. */
  amountAtStake: z.number().nonnegative(),
  currency: CurrencySchema,
  /** Deadline / expected-by date (ISO). Null when not time-bound. */
  dueAt: z.string().datetime({ offset: true }).nullable(),
  severity: FindingSeveritySchema,
  status: FindingStatusSchema.default("open"),
  /** e.g. "R1@1". Bump when rule logic changes. */
  ruleVersion: z.string(),
  /** One-line human explanation, e.g. "Return received Oct 2; no refund after 10 days." */
  summary: z.string(),
  evidence: z.array(FindingEvidenceSchema).min(1),
  /** Rule inputs/intermediate values for the "Why?" panel (expected amount, SLA days, source of policy, ...). */
  explain: z.record(z.string(), z.unknown()),
  /** True when based on simulated data (mock price feed). UI must label it "simulated". */
  simulated: z.boolean().default(false),
});
export type Finding = z.infer<typeof FindingSchema>;
