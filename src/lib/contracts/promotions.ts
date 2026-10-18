import { z } from "zod";

/**
 * Promotions (#131): offers read from marketing emails. Display data only: never part of the owed total, never
 * produced by the rules engine. `source` says whether the details were read by rules or refined by Claude.
 */
export const PromotionDiscountKindSchema = z.enum(["percent", "amount", "free_shipping", "bogo", "other"]);
export type PromotionDiscountKind = z.infer<typeof PromotionDiscountKindSchema>;

export const PromotionDiscountSchema = z.object({
  kind: PromotionDiscountKindSchema,
  /** Percent (20 = 20% off) or amount in major units; null for free shipping / bogo / other. */
  value: z.number().nonnegative().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  /** Minimum spend the offer needs, in `currency`; null when none is stated. */
  minSpend: z.number().nonnegative().nullable(),
});
export type PromotionDiscount = z.infer<typeof PromotionDiscountSchema>;

export const PromotionChannelSchema = z.enum(["online", "in_store", "both"]);
export type PromotionChannel = z.infer<typeof PromotionChannelSchema>;

export const PromotionSchema = z.object({
  /** Stable: the id of the (earliest) email; when the same offer arrives twice the earliest email's id is kept. */
  id: z.string().min(1),
  emailIds: z.array(z.string().min(1)).min(1),
  /** Linked Gmail account the (newest) email came from (#114); unset for demo data and uploads. */
  accountId: z.string().min(1).optional(),
  store: z.string().min(1),
  storeDomain: z.string().nullable(),
  /** ISO time of the newest email carrying this offer. */
  receivedAt: z.string(),
  /** Short offer text, e.g. "$10 off a $40 order". */
  headline: z.string().min(1),
  discount: PromotionDiscountSchema.nullable(),
  /** Promo codes exactly as written in the email; each one appears verbatim in the email text. */
  codes: z.array(z.string().min(1)),
  /** ISO time the offer ends; null when the email states no end. Date-only ends ("ends Oct 20") mean 23:59 local time. */
  expiresAt: z.string().nullable(),
  channel: PromotionChannelSchema.nullable(),
  source: z.enum(["rules", "llm"]),
  /** 0 to 1: how sure the reading is (rules: from the signals found; Claude: its own estimate, capped for rules-only fields). */
  confidence: z.number().min(0).max(1),
});
export type Promotion = z.infer<typeof PromotionSchema>;
