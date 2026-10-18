import { z } from "zod";

/** Purchase vocabulary shared by orders and extraction (#127). */

/** What kind of purchase this is (#127); decides which card the UI shows. Absent on older data: treat as "other". */
export const PurchaseKindSchema = z.enum(["shipped", "in_store", "digital", "subscription", "food_delivery", "travel", "other"]);
export type PurchaseKind = z.infer<typeof PurchaseKindSchema>;

/**
 * Where a package is. `ready_for_pickup` = arrived at a pickup point (convenience store, locker, post office) and
 * waits for the shopper; picking it up counts as `delivered`.
 */
export const ShipmentStatusSchema = z.enum([
  "ordered",
  "shipped",
  "out_for_delivery",
  "ready_for_pickup",
  "delivered",
  "returned",
  "unknown",
]);
export type ShipmentStatus = z.infer<typeof ShipmentStatusSchema>;

export const SubscriptionIntervalSchema = z.enum(["week", "month", "year"]);
export type SubscriptionInterval = z.infer<typeof SubscriptionIntervalSchema>;
