import { z } from "zod";
import { CurrencySchema, EvidenceSchema } from "./extraction";

/** Mirrors the `event.type` enum in src/db/schema/orders.ts. */
export const OrderEventTypeSchema = z.enum([
  "shipped",
  "delivered",
  "return_started",
  "return_dropped",
  "return_received",
  "refund_issued",
  "store_credit",
  "price_adjust",
  "cancel",
]);
export type OrderEventType = z.infer<typeof OrderEventTypeSchema>;

export const OrderEventSchema = z.object({
  id: z.string(),
  type: OrderEventTypeSchema,
  /** ISO datetime. */
  at: z.string().datetime({ offset: true }),
  amount: z.number().nullable().optional(),
  /** Source email id (RawEmail.id). */
  messageId: z.string(),
  conf: z.number().min(0).max(1),
  evidence: EvidenceSchema.optional(),
  /** Line items this event applies to (partial returns); empty/missing = whole order. */
  lineItemIds: z.array(z.string()).optional(),
});
export type OrderEvent = z.infer<typeof OrderEventSchema>;

/** Merchant policy as known for one order. Unknown = null (rules then use their default table or stay silent). */
export const MerchantPolicySchema = z.object({
  returnWindowDays: z.number().int().positive().nullable(),
  windowAnchor: z.enum(["order", "delivery"]).nullable(),
  refundSlaDays: z.number().int().positive().nullable(),
  priceAdjustDays: z.number().int().positive().nullable(),
  policySource: z.enum(["email_text", "default_table", "user"]).nullable(),
  policyQuote: EvidenceSchema.nullable(),
  /** Final sale / perishable / gift card / custom: suppresses return alerts. */
  nonReturnable: z.boolean().default(false),
});
export type MerchantPolicy = z.infer<typeof MerchantPolicySchema>;

export const NormalizedLineItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  sku: z.string().nullable().optional(),
  qty: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  returnedQty: z.number().int().nonnegative().default(0),
});
export type NormalizedLineItem = z.infer<typeof NormalizedLineItemSchema>;

/**
 * One order after matching/dedup (issue #8 output). This is the input to the rules engine (#13-#15)
 * and the shape the ledger UI renders.
 */
export const NormalizedOrderSchema = z.object({
  id: z.string(),
  merchant: z.object({
    name: z.string(),
    domain: z.string().nullable(),
    policy: MerchantPolicySchema,
  }),
  orderRef: z.string().nullable(),
  placedAt: z.string().datetime({ offset: true }),
  currency: CurrencySchema,
  subtotal: z.number().nullable(),
  tax: z.number().nullable(),
  shipping: z.number().nullable(),
  discount: z.number().nullable(),
  total: z.number(),
  last4: z.string().nullable(),
  customerName: z.string().nullable(),
  lineItems: z.array(NormalizedLineItemSchema),
  /** Sorted ascending by `at`. */
  events: z.array(OrderEventSchema),
  /** Source email ids that contributed to this order. */
  messageIds: z.array(z.string()),
  /** Lowest extraction confidence among contributing emails. */
  confMin: z.number().min(0).max(1),
  needsReview: z.boolean(),
});
export type NormalizedOrder = z.infer<typeof NormalizedOrderSchema>;
