import {
  MAX_TRACKING_NUMBERS,
  MAX_TRAVEL_SEGMENTS,
  OTHER_REFS_MAX,
  OTHER_REF_MAX_CHARS,
  PurchaseKindSchema,
  ShipmentStatusSchema,
  SubscriptionIntervalSchema,
  type ExtractedFieldName,
  type RedactedEmail,
} from "@/lib/contracts";
import type { LlmTool } from "@/lib/llm";
import { senderDomain } from "./text";

/**
 * Prompt and forced tool for LLM extraction (issue #7). The tool's JSON Schema is hand-written to mirror
 * ExtractedFieldsSchema plus per-field confidence and evidence; extract.ts validates the result with Zod.
 */

export const EXTRACTION_TOOL_NAME = "record_extraction";

export const EXTRACTION_SYSTEM_PROMPT = [
  "You extract structured purchase data from one shopping email for a personal receipt ledger.",
  "Personal data in the email is replaced by tokens like [PAN_1], [PHONE_1], [ADDRESS_1], [EMAIL_1], [NAME_1]; never try to reconstruct them.",
  "Rules:",
  "- Extract only what the email explicitly states. Use null when a value is unknown or not stated. Never guess.",
  "- Never compute, infer, convert, or sum amounts. Copy each amount exactly as written, as a plain number in major units (19.99).",
  "- currency is the ISO 4217 code (USD, EUR, GBP) only when the email states or clearly shows it; otherwise null.",
  "- date is ISO 8601 (YYYY-MM-DD or full datetime): the order/event date stated in the email body, else the email date.",
  "- customerName must be null. Customer names are private; never infer or reconstruct them from tokens.",
  "- last4 is the 4 card digits only when the email shows them (e.g. 'ending in 4242'); otherwise null.",
  "- eventAmount is the refund, price adjustment, or store credit amount stated in refund/adjustment/credit emails.",
  "- otherRefs lists every other reference number printed in the email besides orderRef (invoice, confirmation, transaction, web order or document numbers), exactly as written; [] when there are none. Never include tracking numbers, phone numbers, amounts or the orderRef itself.",
  "- shipment (shipping / tracking / pickup emails only; null otherwise): carrier as named in the email; trackingNumbers copied exactly as printed (also for a tracking number inside a tracking link), [] when none is printed - never an order number, never invented; status is what THIS email says about the package (shipped, out_for_delivery, ready_for_pickup when it arrived at a pickup point such as a convenience store or locker and waits for the shopper, delivered also when the shopper picked it up, returned); eta only as an ISO date/datetime the email states (delivery date or pickup deadline); pickupLocation is the pickup store or locker named by the email. Never write a tracking URL.",
  "- kindGuess is your best guess of the purchase kind: shipped (physical goods sent to the shopper, incl. convenience-store pickup), in_store, digital (apps, games, downloads), subscription (recurring billing), food_delivery, travel, other. Use null when unsure.",
  "- subscription (null unless the email is recurring billing): plan name, interval week/month/year as stated, nextRenewal as an ISO date only when stated. travel (null unless a trip): segments (flight, hotel or ride label with ISO start/end when stated) and the booking confirmation code. restaurant for food delivery, platform for digital stores (App Store, Google Play, Steam), storeLocation for in-store purchases; null when not stated.",
  "- Emails may be in English or Traditional Chinese (已出貨, 配送中, 已到店, 可取貨, 已取貨, 已送達, 已簽收); read them the same way.",
  "- returnWindowDays, refundSlaDays, priceAdjustDays and policyQuote only when the email itself states the policy.",
  "- For every non-null field give confidence (0 to 1) and an evidence quote of at most 200 characters copied verbatim from the email.",
  `Always answer by calling the ${EXTRACTION_TOOL_NAME} tool.`,
].join("\n");

const nullableString = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };
const nullablePositiveInteger = { type: ["integer", "null"], minimum: 1 };

/** JSON Schema mirror of ExtractedFieldsSchema. Keys must match ExtractedFieldNameSchema (guarded by a test). */
const FIELD_PROPERTIES: Record<ExtractedFieldName, Record<string, unknown>> = {
  merchant: { ...nullableString, description: "Store name as written" },
  merchantDomain: { ...nullableString, description: "Store web domain, e.g. northwind.example" },
  orderRef: { ...nullableString, description: "Order number as written, e.g. NW-1001" },
  date: { ...nullableString, description: "ISO 8601 date or datetime" },
  currency: { type: ["string", "null"], pattern: "^[A-Z]{3}$", description: "ISO 4217 code" },
  lineItems: {
    type: "array",
    items: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1 },
        sku: nullableString,
        qty: { type: "integer", minimum: 1 },
        unitPrice: { type: "number", minimum: 0, description: "Unit price as written, major units" },
      },
      required: ["name", "qty", "unitPrice"],
      additionalProperties: false,
    },
  },
  totals: {
    type: "object",
    properties: {
      subtotal: nullableNumber,
      tax: nullableNumber,
      shipping: nullableNumber,
      discount: nullableNumber,
      total: nullableNumber,
    },
    additionalProperties: false,
  },
  last4: { type: ["string", "null"], pattern: "^\\d{4}$" },
  customerName: { ...nullableString, description: "Always null; customer names are redacted before extraction" },
  eventAmount: { ...nullableNumber, description: "Refund / price adjustment / store credit amount as written" },
  returnWindowDays: nullablePositiveInteger,
  refundSlaDays: nullablePositiveInteger,
  priceAdjustDays: nullablePositiveInteger,
  policyQuote: { type: ["string", "null"], maxLength: 200, description: "Verbatim policy sentence" },
  isStoreCredit: { type: "boolean", description: "True only when a refund was issued as store credit" },
};

/** Package facts of a shipping email (#127). Not scored. */
const SHIPMENT_PROPERTY = {
  type: ["object", "null"],
  properties: {
    carrier: nullableString,
    trackingNumbers: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 64 },
      maxItems: MAX_TRACKING_NUMBERS,
      description: "Tracking numbers exactly as printed; never order numbers",
    },
    status: { type: ["string", "null"], enum: [...ShipmentStatusSchema.options, null] },
    eta: { ...nullableString, description: "ISO date/datetime of expected delivery or pickup deadline" },
    pickupLocation: nullableString,
  },
  additionalProperties: false,
};

const SUBSCRIPTION_PROPERTY = {
  type: ["object", "null"],
  properties: {
    plan: nullableString,
    interval: { type: ["string", "null"], enum: [...SubscriptionIntervalSchema.options, null] },
    nextRenewal: { ...nullableString, description: "ISO date" },
  },
  additionalProperties: false,
};

const TRAVEL_PROPERTY = {
  type: ["object", "null"],
  properties: {
    segments: {
      type: "array",
      maxItems: MAX_TRAVEL_SEGMENTS,
      items: {
        type: "object",
        properties: { label: { type: "string", minLength: 1 }, start: nullableString, end: nullableString },
        required: ["label"],
        additionalProperties: false,
      },
    },
    confirmation: nullableString,
  },
  additionalProperties: false,
};

/** Kind and kind-specific details (#127): not scored fields (no confidence/evidence entry), like otherRefs. */
const KIND_PROPERTIES = {
  kindGuess: { type: ["string", "null"], enum: [...PurchaseKindSchema.options, null] },
  shipment: SHIPMENT_PROPERTY,
  subscription: SUBSCRIPTION_PROPERTY,
  travel: TRAVEL_PROPERTY,
  restaurant: nullableString,
  platform: nullableString,
  storeLocation: nullableString,
};

/** Not a scored field (no confidence/evidence entry), so it lives outside FIELD_PROPERTIES. */
const OTHER_REFS_PROPERTY = {
  type: "array",
  items: { type: "string", minLength: 1, maxLength: OTHER_REF_MAX_CHARS },
  maxItems: OTHER_REFS_MAX,
  description: "Other reference numbers in the email (invoice, confirmation, transaction, web order), as written",
};

const FIELD_NAMES = Object.keys(FIELD_PROPERTIES) as ExtractedFieldName[];

function perFieldObject(valueSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "object",
    properties: Object.fromEntries(FIELD_NAMES.map((name) => [name, valueSchema])),
    additionalProperties: false,
  };
}

export const EXTRACTION_TOOL: LlmTool = {
  name: EXTRACTION_TOOL_NAME,
  description: "Record the purchase fields stated in the email, with per-field confidence and verbatim evidence.",
  input_schema: {
    type: "object",
    properties: {
      fields: {
        type: "object",
        properties: { ...FIELD_PROPERTIES, otherRefs: OTHER_REFS_PROPERTY, ...KIND_PROPERTIES },
        required: ["merchant", "orderRef", "date", "currency", "lineItems", "totals"],
        additionalProperties: false,
      },
      confidence: perFieldObject({ type: "number", minimum: 0, maximum: 1 }),
      evidence: perFieldObject({ type: "string", maxLength: 200 }),
    },
    required: ["fields", "confidence", "evidence"],
    additionalProperties: false,
  },
};

/**
 * User turn for one email: sender domain, email date, redacted subject and redacted body only.
 * Never includes the From/To addresses.
 */
export function buildExtractionPrompt(email: RedactedEmail): string {
  return [
    `Sender domain: ${senderDomain(email.from) ?? "unknown"}`,
    `Email date: ${email.date}`,
    `Subject: ${email.subject}`,
    "Body:",
    "<<<",
    email.text,
    ">>>",
  ].join("\n");
}

/** Appended on the single retry so the model can fix its previous tool call. */
export function buildRetryPrompt(email: RedactedEmail, validationError: string): string {
  return [
    buildExtractionPrompt(email),
    "",
    `Your previous ${EXTRACTION_TOOL_NAME} call failed validation:`,
    validationError,
    `Call ${EXTRACTION_TOOL_NAME} again with corrected values. Use null for anything not stated in the email.`,
  ].join("\n");
}
