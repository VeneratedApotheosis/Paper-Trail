import { z } from "zod";
import { PromotionChannelSchema, PromotionDiscountKindSchema, type Promotion } from "@/lib/contracts";
import type { ExtractionAuditEntry } from "@/lib/ingestion";
import { LlmUnavailableError, type LlmClient, type LlmTool } from "@/lib/llm";
import { llmErrorClass } from "@/lib/llm/audit";
import { normalizeExpiry, type PromotionEmail, type RulesOptions } from "./rules";
import type { PromotionDetails } from "./types";

/**
 * Claude's reading of one marketing email (#131): a dedicated prompt and tool, validated with Zod, retried once with
 * the validation error, then dropped in favour of the rules' reading. Claude never invents a promo code: a code must
 * appear verbatim in the (redacted) email text or it is discarded. Numbers on the page are display only; they never feed
 * the owed total (hard rule 4).
 */

export const PROMOTION_TOOL_NAME = "record_promotion";
const MAX_ATTEMPTS = 2;
const MAX_EMAIL_CHARS = 6000;
const MAX_HEADLINE_CHARS = 120;
const MAX_CODES = 5;
const MAX_VALIDATION_ERROR_CHARS = 600;

export const PROMOTION_SYSTEM_PROMPT = [
  "You read one marketing email for a personal shopping app and describe the offer in it.",
  "Personal data in the email is replaced by tokens like [PHONE_1], [ADDRESS_1], [EMAIL_1], [NAME_1]; never try to reconstruct them.",
  "Rules:",
  "- Use only what the email states. Use null when something is not stated. Never guess.",
  "- headline is the offer in a few plain words, at most 120 characters, e.g. \"$10 off a $40 pickup order\" or \"20% off sitewide\". Write it in the email's language.",
  "- discount.kind is percent, amount, free_shipping, bogo or other. value is the percent or the amount exactly as written (a plain number); null for free_shipping, bogo and other. currency is an ISO 4217 code only when the email shows it, else null. minSpend is the minimum spend the offer needs, else null.",
  "- codes are promo codes copied EXACTLY as written in the email, character for character. Never invent, complete or fix a code. If there is no code, return an empty list.",
  "- expiresAt is when the offer ends: an ISO 8601 date (YYYY-MM-DD) when the email gives no time of day, or a full date-time when it does. Resolve phrases such as \"ends tonight\", \"through Sunday\" or \"in 48 hours\" against the email date given in the message. Use null when the email states no end.",
  "- channel is online, in_store or both when the email says where the offer applies, else null.",
  "- confidence is 0 to 1: how sure you are of the reading.",
  `Always answer by calling the ${PROMOTION_TOOL_NAME} tool.`,
].join("\n");

const nullableNumber = { type: ["number", "null"] };

export const PROMOTION_TOOL: LlmTool = {
  name: PROMOTION_TOOL_NAME,
  description: "Record the offer described by the marketing email.",
  input_schema: {
    type: "object",
    properties: {
      headline: { type: "string", maxLength: MAX_HEADLINE_CHARS, description: "The offer in a few plain words" },
      discount: {
        type: ["object", "null"],
        properties: {
          kind: { type: "string", enum: PromotionDiscountKindSchema.options },
          value: { ...nullableNumber, description: "Percent or amount as written" },
          currency: { type: ["string", "null"], pattern: "^[A-Z]{3}$" },
          minSpend: nullableNumber,
        },
        required: ["kind", "value", "currency", "minSpend"],
        additionalProperties: false,
      },
      codes: { type: "array", items: { type: "string", minLength: 1, maxLength: 30 }, maxItems: MAX_CODES, description: "Promo codes copied exactly as written" },
      expiresAt: { type: ["string", "null"], description: "ISO 8601 date or date-time the offer ends" },
      channel: { type: ["string", "null"], enum: [...PromotionChannelSchema.options, null] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["headline", "discount", "codes", "expiresAt", "channel", "confidence"],
    additionalProperties: false,
  },
};

const ToolInputSchema = z.object({
  headline: z.string().trim().min(1).transform((value) => value.slice(0, MAX_HEADLINE_CHARS)),
  discount: z.object({
    kind: PromotionDiscountKindSchema,
    value: z.number().nonnegative().nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    minSpend: z.number().nonnegative().nullable(),
  }).nullable(),
  codes: z.array(z.string().trim().min(1).max(30)).max(MAX_CODES),
  expiresAt: z.string().nullable(),
  channel: PromotionChannelSchema.nullable(),
  confidence: z.number().min(0).max(1),
});

export function buildPromotionPrompt(email: Pick<PromotionEmail, "fromName" | "fromDomain" | "subject" | "date" | "text">): string {
  return [
    `Email date: ${email.date}`,
    `Sender: ${email.fromName ?? "unknown"} (${email.fromDomain ?? "unknown domain"})`,
    `Subject: ${email.subject}`,
    "",
    email.text.slice(0, MAX_EMAIL_CHARS),
  ].join("\n");
}

function buildRetryPrompt(email: Parameters<typeof buildPromotionPrompt>[0], error: string): string {
  return `${buildPromotionPrompt(email)}\n\nYour previous answer was invalid:\n${error}\nAnswer again by calling ${PROMOTION_TOOL_NAME} with valid fields.`;
}

/** A number counts as "in the email" when its digits appear as a separate number (10, 10.00, 1,000). */
function numberAppears(text: string, value: number): boolean {
  const forms = new Set([String(value), value.toFixed(2), value.toLocaleString("en-US")]);
  return [...forms].some((form) => new RegExp(String.raw`(?<![\d.,])${form.replace(/[.,]/g, "\\$&")}(?!\d)`).test(text));
}

/** Validates the tool input and drops what the email does not support: codes not in the text, amounts not in the text. */
export function verifyPromotionDetails(toolInput: unknown, email: Pick<PromotionEmail, "date" | "text">, options: RulesOptions = {}): { ok: true; details: PromotionDetails } | { ok: false; error: string } {
  const parsed = ToolInputSchema.safeParse(toolInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n").slice(0, MAX_VALIDATION_ERROR_CHARS) };
  }
  const input = parsed.data;
  const codes = [...new Set(input.codes)].filter((code) => email.text.includes(code));
  let discount = input.discount;
  if (discount) {
    const checked = (value: number | null) => (value !== null && numberAppears(email.text, value) ? value : null);
    discount = { ...discount, value: discount.kind === "amount" ? checked(discount.value) : discount.value, minSpend: checked(discount.minSpend) };
  }
  return {
    ok: true,
    details: {
      headline: input.headline,
      discount,
      codes,
      expiresAt: input.expiresAt === null ? null : normalizeExpiry(input.expiresAt, email.date, options),
      channel: input.channel,
      confidence: Math.round(input.confidence * 100) / 100,
    },
  };
}

/** Claude's details laid over the rules' reading: a field Claude leaves empty keeps the rules' value; codes are the union. */
export function applyPromotionDetails(promotion: Promotion, details: PromotionDetails): Promotion {
  const codes = [...details.codes];
  for (const code of promotion.codes) if (!codes.includes(code)) codes.push(code);
  return {
    ...promotion,
    headline: details.headline,
    discount: details.discount ?? promotion.discount,
    codes: codes.slice(0, MAX_CODES),
    expiresAt: details.expiresAt ?? promotion.expiresAt,
    channel: details.channel ?? promotion.channel,
    source: "llm",
    confidence: details.confidence,
  };
}

export interface PromotionLlmDeps {
  llm: LlmClient;
  /** One row per provider request that was attempted (same row shape and rules as extraction's llm_call rows). */
  audit?: (entry: ExtractionAuditEntry) => void;
  now?: () => Date;
  rules?: RulesOptions;
}

export type PromotionLlmOutcome =
  | { kind: "details"; details: PromotionDetails }
  /** Two invalid answers, or a provider error: keep the rules' reading. */
  | { kind: "kept_rules" }
  /** No API key: nothing was sent, and nothing else will be either. */
  | { kind: "unavailable" };

/**
 * Asks Claude for one email's offer. Invalid output is retried once with the validation error; a second failure or a
 * provider error keeps the rules' reading (never throws).
 */
export async function readPromotionWithClaude(emailId: string, email: Pick<PromotionEmail, "fromName" | "fromDomain" | "subject" | "date" | "text">, textHash: string, deps: PromotionLlmDeps): Promise<PromotionLlmOutcome> {
  const now = deps.now ?? (() => new Date());
  let user = buildPromotionPrompt(email);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response;
    try {
      response = await deps.llm.callTool({ system: PROMOTION_SYSTEM_PROMPT, user, tool: PROMOTION_TOOL, textHash });
    } catch (error) {
      if (error instanceof LlmUnavailableError) return { kind: "unavailable" };
      deps.audit?.({ at: now().toISOString(), actor: "llm", action: "llm_call", model: deps.llm.model, inputTokens: 0, outputTokens: 0, emailId, outcome: "error", errorClass: llmErrorClass(error) });
      return { kind: "kept_rules" };
    }
    deps.audit?.({ at: now().toISOString(), actor: "llm", action: "llm_call", model: response.model, inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens, emailId, outcome: "success" });
    const verified = verifyPromotionDetails(response.toolInput, email, deps.rules);
    if (verified.ok) return { kind: "details", details: verified.details };
    user = buildRetryPrompt(email, verified.error);
  }
  return { kind: "kept_rules" };
}
