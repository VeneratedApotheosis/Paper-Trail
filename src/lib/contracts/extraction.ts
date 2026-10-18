import { z } from "zod";
import { EmailClassSchema } from "./email";

/** ISO-4217 currency code. */
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/);

/** Evidence quotes are capped at 200 chars (scope_features F1.4). */
export const EvidenceSchema = z.string().max(200);

export const ExtractedLineItemSchema = z.object({
  name: z.string().min(1),
  sku: z.string().nullable().optional(),
  qty: z.number().int().positive().default(1),
  /** Unit price in the order currency (major units, e.g. 19.99). */
  unitPrice: z.number().nonnegative(),
});
export type ExtractedLineItem = z.infer<typeof ExtractedLineItemSchema>;

export const ExtractedTotalsSchema = z.object({
  subtotal: z.number().nullable().optional(),
  tax: z.number().nullable().optional(),
  shipping: z.number().nullable().optional(),
  discount: z.number().nullable().optional(),
  total: z.number().nullable().optional(),
});
export type ExtractedTotals = z.infer<typeof ExtractedTotalsSchema>;

/** Fields the LLM extracts from one (redacted) email. All values are nullable: unknown is allowed, guessing is not. */
export const OTHER_REFS_MAX = 10;
export const OTHER_REF_MAX_CHARS = 64;

export const ExtractedFieldsSchema = z.object({
  merchant: z.string().nullable(),
  merchantDomain: z.string().nullable().optional(),
  orderRef: z.string().nullable(),
  /** ISO date/datetime the order/event happened (from the email body, else the email date). */
  date: z.string().nullable(),
  currency: CurrencySchema.nullable(),
  lineItems: z.array(ExtractedLineItemSchema).default([]),
  totals: ExtractedTotalsSchema.default({}),
  last4: z.string().regex(/^\d{4}$/).nullable().optional(),
  customerName: z.string().nullable().optional(),
  /** Amount for refund / price_adjust / store-credit emails. */
  eventAmount: z.number().nullable().optional(),
  /** Policy facts stated in the email text (used by rules R1-R3 when present). */
  returnWindowDays: z.number().int().positive().nullable().optional(),
  refundSlaDays: z.number().int().positive().nullable().optional(),
  priceAdjustDays: z.number().int().positive().nullable().optional(),
  policyQuote: EvidenceSchema.nullable().optional(),
  /** Refund was issued as store credit instead of to the original tender. */
  isStoreCredit: z.boolean().optional(),
  /**
   * Every other reference number the email prints besides `orderRef` (invoice, confirmation, transaction, web order,
   * ...), as written (#126). Emails that share any reference belong to one purchase. Not a scored field: it has no
   * confidence or evidence entry. Never tracking numbers, phone numbers or amounts.
   */
  otherRefs: z.array(z.string().min(1).max(OTHER_REF_MAX_CHARS)).max(OTHER_REFS_MAX).optional(),
});
export type ExtractedFields = z.infer<typeof ExtractedFieldsSchema>;

export const ExtractedFieldNameSchema = z.enum([
  "merchant",
  "merchantDomain",
  "orderRef",
  "date",
  "currency",
  "lineItems",
  "totals",
  "last4",
  "customerName",
  "eventAmount",
  "returnWindowDays",
  "refundSlaDays",
  "priceAdjustDays",
  "policyQuote",
  "isStoreCredit",
]);
export type ExtractedFieldName = z.infer<typeof ExtractedFieldNameSchema>;

/** Full extraction result for one email (issue #7). */
export const ExtractionSchema = z.object({
  emailId: z.string(),
  class: EmailClassSchema,
  fields: ExtractedFieldsSchema,
  /** Per-field confidence 0-1. Missing key = field not extracted. */
  confidence: z.record(ExtractedFieldNameSchema, z.number().min(0).max(1)),
  /** Per-field evidence quote from the (redacted) email, <=200 chars. */
  evidence: z.record(ExtractedFieldNameSchema, EvidenceSchema),
  /** Lowest confidence across extracted fields; < 0.7 => needs review. */
  confMin: z.number().min(0).max(1),
  model: z.string(),
  /** True when served from the cache keyed by RedactedEmail.textHash. */
  cached: z.boolean().default(false),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

/** Confidence below this goes to the needs-review queue and is excluded from "owed" totals. */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.7;
