import { z } from "zod";
import { CurrencySchema } from "@/lib/contracts";

const label = z.string().trim().min(1).max(200);
const money = z.number().finite().nonnegative().max(1_000_000_000)
  .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, "Use at most two decimal places");
export const ReviewEditSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("merchantName"), value: label }).strict(),
  z.object({ field: z.literal("orderRef"), value: label }).strict(),
  z.object({ field: z.literal("placedAt"), value: z.string().datetime({ offset: true }) }).strict(),
  z.object({ field: z.literal("currency"), value: CurrencySchema }).strict(),
  z.object({ field: z.literal("total"), value: money }).strict(),
  z.object({ field: z.literal("subtotal"), value: money.nullable() }).strict(),
  z.object({ field: z.literal("tax"), value: money.nullable() }).strict(),
  z.object({ field: z.literal("shipping"), value: money.nullable() }).strict(),
  z.object({ field: z.literal("discount"), value: money.nullable() }).strict(),
  z.object({ field: z.literal("lineItemName"), lineItemId: z.string().min(1), value: label }).strict(),
  z.object({ field: z.literal("lineItemQty"), lineItemId: z.string().min(1), value: z.number().int().min(1).max(100000) }).strict(),
  z.object({ field: z.literal("lineItemUnitPrice"), lineItemId: z.string().min(1), value: money }).strict(),
]);
export type ReviewEdit = z.infer<typeof ReviewEditSchema>;
export const EditRequestSchema = z.object({ revision: z.string().uuid(), edit: ReviewEditSchema }).strict();
export const ConfirmRequestSchema = z.object({ revision: z.string().uuid(), confirmed: z.literal(true) }).strict();
