import { z } from "zod";
import { EmailClassSchema } from "./email";
import { PurchaseKindSchema, ShipmentStatusSchema, SubscriptionIntervalSchema } from "./purchase";

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

/**
 * Package facts a shipping / tracking email states (#127). Not scored (no confidence or evidence entry). Tracking
 * numbers are validated against the email text by the matcher before they are used; the tracking URL is never taken
 * from the LLM (code builds it from carrier + number).
 */
export const MAX_TRACKING_NUMBERS = 10;
export const ExtractedShipmentSchema = z.object({
  carrier: z.string().nullable().optional(),
  trackingNumbers: z.array(z.string().min(1).max(64)).max(MAX_TRACKING_NUMBERS).default([]),
  /** What this email says about the package, e.g. "shipped", "out_for_delivery", "ready_for_pickup", "delivered". */
  status: ShipmentStatusSchema.nullable().optional(),
  /** ISO date/datetime of the expected delivery or pickup deadline. */
  eta: z.string().nullable().optional(),
  /** Pickup store / locker named by a pickup notification. */
  pickupLocation: z.string().nullable().optional(),
});
export type ExtractedShipment = z.infer<typeof ExtractedShipmentSchema>;

export const MAX_TRAVEL_SEGMENTS = 12;
export const ExtractedTravelSchema = z.object({
  segments: z.array(z.object({ label: z.string().min(1), start: z.string().nullable(), end: z.string().nullable() })).max(MAX_TRAVEL_SEGMENTS).default([]),
  confirmation: z.string().nullable().optional(),
});
export type ExtractedTravel = z.infer<typeof ExtractedTravelSchema>;

export const ExtractedSubscriptionSchema = z.object({
  plan: z.string().nullable().optional(),
  interval: SubscriptionIntervalSchema.nullable().optional(),
  /** ISO date of the next renewal / charge. */
  nextRenewal: z.string().nullable().optional(),
});
export type ExtractedSubscription = z.infer<typeof ExtractedSubscriptionSchema>;

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
  /**
   * Purchase kind the model guesses (#127). Only a fallback: the matcher decides the kind from rules first (tracking
   * evidence, recurring billing, merchant tables) and ignores this when its extraction confidence is low. Not scored.
   */
  kindGuess: PurchaseKindSchema.nullable().optional(),
  /** Carrier, tracking numbers, package status, ETA and pickup store (shipping / tracking emails). Not scored. */
  shipment: ExtractedShipmentSchema.nullable().optional(),
  subscription: ExtractedSubscriptionSchema.nullable().optional(),
  travel: ExtractedTravelSchema.nullable().optional(),
  /** Restaurant behind a food-delivery order. */
  restaurant: z.string().nullable().optional(),
  /** Digital store / platform (App Store, Google Play, Steam, ...). */
  platform: z.string().nullable().optional(),
  /** Store location of an in-store purchase. */
  storeLocation: z.string().nullable().optional(),
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
