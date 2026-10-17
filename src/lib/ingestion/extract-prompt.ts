import type { ExtractedFieldName, RedactedEmail } from "@/lib/contracts";
import type { LlmTool } from "@/lib/llm";
import { senderDomain } from "./text";

/**
 * Prompt and forced tool for LLM extraction (issue #7). The tool's JSON Schema is hand-written to mirror
 * ExtractedFieldsSchema plus per-field confidence and evidence; extract.ts validates the result with Zod.
 */

export const EXTRACTION_TOOL_NAME = "record_extraction";

export const EXTRACTION_SYSTEM_PROMPT = [
  "You extract structured purchase data from one shopping email for a personal receipt ledger.",
  "Personal data in the email is replaced by tokens like [PAN_1], [PHONE_1], [ADDRESS_1], [EMAIL_1]; never try to reconstruct them.",
  "Rules:",
  "- Extract only what the email explicitly states. Use null when a value is unknown or not stated. Never guess.",
  "- Never compute, infer, convert, or sum amounts. Copy each amount exactly as written, as a plain number in major units (19.99).",
  "- currency is the ISO 4217 code (USD, EUR, GBP) only when the email states or clearly shows it; otherwise null.",
  "- date is ISO 8601 (YYYY-MM-DD or full datetime): the order/event date stated in the email body, else the email date.",
  "- last4 is the 4 card digits only when the email shows them (e.g. 'ending in 4242'); otherwise null.",
  "- eventAmount is the refund, price adjustment, or store credit amount stated in refund/adjustment/credit emails.",
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
  customerName: { ...nullableString, description: "Name the email addresses the customer by" },
  eventAmount: { ...nullableNumber, description: "Refund / price adjustment / store credit amount as written" },
  returnWindowDays: nullablePositiveInteger,
  refundSlaDays: nullablePositiveInteger,
  priceAdjustDays: nullablePositiveInteger,
  policyQuote: { type: ["string", "null"], maxLength: 200, description: "Verbatim policy sentence" },
  isStoreCredit: { type: "boolean", description: "True only when a refund was issued as store credit" },
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
        properties: FIELD_PROPERTIES,
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
