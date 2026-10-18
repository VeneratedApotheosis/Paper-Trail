import { z } from "zod";

/**
 * Pipeline input. Gmail sync and demo mode (seed/inbox.json, .eml upload) both produce RawEmail,
 * so everything downstream runs the same code path.
 */
export const RawEmailSchema = z.object({
  /** Gmail message id, or a stable synthetic id for seed/demo data. */
  id: z.string().min(1),
  threadId: z.string().optional(),
  /** Full From header, e.g. `"Northwind Outfitters" <orders@northwind.example>`. */
  from: z.string().min(1),
  to: z.string().optional(),
  subject: z.string(),
  /** ISO-8601 timestamp the message was received/sent. */
  date: z.string().datetime({ offset: true }),
  /** Plain-text body (HTML already converted to text). */
  text: z.string(),
  html: z.string().optional(),
  labels: z.array(z.string()).optional(),
  /**
   * Linked Gmail account the message was fetched from (#114: `GET /api/account` `accounts[].id`). Unset for demo data
   * and uploads. Opaque id, never the mailbox address; the pipeline copies it onto `NormalizedOrder.sources`.
   */
  sourceAccount: z.string().min(1).optional(),
});
export type RawEmail = z.infer<typeof RawEmailSchema>;

/** Kinds of PII replaced before any LLM call (AGENTS.md hard rule #3). */
export const RedactionKindSchema = z.enum(["pan", "phone", "address", "email"]);
export type RedactionKind = z.infer<typeof RedactionKindSchema>;

/** A RawEmail after redaction. Only this shape may be sent to an LLM. */
export const RedactedEmailSchema = RawEmailSchema.omit({ html: true }).extend({
  /** Redacted plain text; PII replaced by tokens like `[PAN_1]`, `[PHONE_1]`, `[ADDRESS_1]`. */
  text: z.string(),
  redactions: z.record(RedactionKindSchema, z.number().int().nonnegative()),
  /** sha256 of the redacted text; LLM cache key. */
  textHash: z.string().min(1),
});
export type RedactedEmail = z.infer<typeof RedactedEmailSchema>;

/** Classifier output labels (issue #6). */
export const EmailClassSchema = z.enum([
  "order",
  "shipped",
  "delivered",
  "return_started",
  "return_received",
  "refund",
  "price_adjust",
  "cancel",
  "marketing",
  "not_receipt",
]);
export type EmailClass = z.infer<typeof EmailClassSchema>;

export const ClassificationSchema = z.object({
  emailId: z.string(),
  class: EmailClassSchema,
  confidence: z.number().min(0).max(1),
  /** Why (rule name or short model rationale). */
  reason: z.string().max(200).optional(),
});
export type Classification = z.infer<typeof ClassificationSchema>;
