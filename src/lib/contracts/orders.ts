import { z } from "zod";
import { CurrencySchema, EvidenceSchema } from "./extraction";
import { PurchaseKindSchema, ShipmentStatusSchema, SubscriptionIntervalSchema } from "./purchase";

/** Mirrors the `event.type` enum in src/db/schema/orders.ts. */
export const OrderEventTypeSchema = z.enum([
  /** The order confirmation (#127); lets a purchase timeline start at "placed". */
  "placed",
  "shipped",
  /** Tracking updates (#127): the carrier has the package on the final leg / it waits at a pickup point. */
  "out_for_delivery",
  "ready_for_pickup",
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

/** One package (one tracking number). Split shipments are several of these on one order. */
export const ShipmentSchema = z.object({
  /** Carrier name as shown to the shopper ("UPS", "FedEx", "7-ELEVEN", ...); null when unknown. */
  carrier: z.string().nullable(),
  /** As printed, upper case without spaces. */
  trackingNumber: z.string().min(1),
  /** Public tracking page, built by code from carrier + number (never by the LLM); null when the carrier has no public URL pattern. */
  trackingUrl: z.string().url().nullable(),
  status: ShipmentStatusSchema,
  /** ISO date or datetime of the expected delivery / pickup deadline; null when unknown or not ISO. */
  eta: z.string().nullable(),
  shippedAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  /** Order line items in this package; empty when the emails do not say. */
  itemIds: z.array(z.string()),
  /** Pickup store / locker for `ready_for_pickup` flows ("7-ELEVEN Xinyi Store"); null otherwise. Additive to the issue contract. */
  pickupLocation: z.string().nullable().optional(),
});
export type Shipment = z.infer<typeof ShipmentSchema>;

export const TravelSegmentSchema = z.object({
  label: z.string(),
  start: z.string().nullable(),
  end: z.string().nullable(),
});
export type TravelSegment = z.infer<typeof TravelSegmentSchema>;

/** Kind-specific facts (#127). `details.kind` always equals the order's `kind`. */
export const PurchaseDetailsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("shipped"), shipments: z.array(ShipmentSchema) }),
  z.object({ kind: z.literal("in_store"), location: z.string().nullable() }),
  z.object({ kind: z.literal("digital"), platform: z.string().nullable() }),
  z.object({
    kind: z.literal("subscription"),
    plan: z.string().nullable(),
    interval: SubscriptionIntervalSchema.nullable(),
    nextRenewal: z.string().nullable(),
  }),
  z.object({ kind: z.literal("food_delivery"), restaurant: z.string().nullable(), deliveredAt: z.string().nullable() }),
  z.object({
    kind: z.literal("travel"),
    segments: z.array(TravelSegmentSchema),
    confirmation: z.string().nullable(),
  }),
  z.object({ kind: z.literal("other") }),
]);
export type PurchaseDetails = z.infer<typeof PurchaseDetailsSchema>;

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
  /**
   * Linked Gmail account ids (`RawEmail.sourceAccount`) whose inboxes contributed to this order, sorted. The same
   * order seen in two inboxes is one order with both ids (#114). Absent for demo data and uploads.
   */
  sources: z.array(z.string()).optional(),
  /**
   * Ids this order had (or would have had) before duplicates were merged into it (#126). Review corrections saved under
   * such an id still apply to this order. Absent when nothing was merged under another id.
   */
  aliasIds: z.array(z.string()).optional(),
  /**
   * Fingerprints of the emails behind this order: `mid:<Message-ID>` and `fp:<body hash>` (#126). Orders from different
   * inboxes that share one are the same purchase. Not shown to users.
   */
  emailKeys: z.array(z.string()).optional(),
  /**
   * The dedup score put this order in the middle band against an earlier order: possibly the same purchase, but not
   * enough evidence to merge (#126). Flag for a later Review card; the order is counted as its own purchase.
   */
  possibleDuplicateOf: z.object({ orderId: z.string(), reason: z.string(), score: z.number() }).optional(),
  /** Purchase kind (#127). Absent on data from before it existed: treat as "other". */
  kind: PurchaseKindSchema.optional(),
  /** Kind-specific facts; `details.kind` equals `kind`. Absent with `kind`. */
  details: PurchaseDetailsSchema.optional(),
  /**
   * True for a package entry built from tracking emails alone (#127): no order confirmation was found, so there is no
   * amount (total 0), the entry never produces findings and never counts toward owed totals. When the receipt arrives
   * it merges in and this flag disappears.
   */
  packageOnly: z.boolean().optional(),
  /** Lowest extraction confidence among contributing emails. */
  confMin: z.number().min(0).max(1),
  needsReview: z.boolean(),
  /** Human review state, separate from the original model confidence/evidence. */
  review: z.object({
    revision: z.string().uuid(),
    confirmedAt: z.string().datetime({ offset: true }).optional(),
    /** Fields the user corrected in Review (ReviewEdit.field names, #124); present on orders showing Corrected by you. */
    correctedFields: z.array(z.string()).optional(),
  }).optional(),
});
export type NormalizedOrder = z.infer<typeof NormalizedOrderSchema>;
