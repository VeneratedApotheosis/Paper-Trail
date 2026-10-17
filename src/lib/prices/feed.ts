import { z } from "zod";
import { CurrencySchema } from "@/lib/contracts";

/**
 * Price sources for R3 (deepdive_S14 §4 price source ladder). `mock` = scripted feed (seed/price-feed.json, issue #5),
 * labeled "simulated" in the UI; `email_promo` = price seen in a promo email from the same merchant.
 */
export const PriceSourceSchema = z.enum(["mock", "email_promo"]);
export type PriceSource = z.infer<typeof PriceSourceSchema>;

export const PriceObservationSchema = z.object({
  /** Merchant display name; matched case-insensitively against NormalizedOrder.merchant.name. */
  merchant: z.string(),
  /** Matched exactly against the line item sku. */
  sku: z.string(),
  name: z.string(),
  /** Major currency units. */
  price: z.number().nonnegative(),
  currency: CurrencySchema,
  /** ISO datetime the price was observed. */
  observedAt: z.string().datetime({ offset: true }),
  /** seed/price-feed.json omits `source`, so it defaults to "mock". */
  source: PriceSourceSchema.default("mock"),
});
export type PriceObservation = z.infer<typeof PriceObservationSchema>;

/** Format of seed/price-feed.json. Library code never reads it from disk; callers load and parse the JSON. */
export const PriceFeedSchema = z.object({
  simulated: z.boolean(),
  observations: z.array(PriceObservationSchema),
});
export type PriceFeed = z.infer<typeof PriceFeedSchema>;

/**
 * Latest observation for `merchant` + `sku` observed at or before `now`, or null when there is none.
 * Merchant names match case-insensitively, skus exactly. Observations at the same instant: lowest price wins.
 */
export function latestPrice(
  feed: PriceFeed,
  merchant: string,
  sku: string,
  now: Date,
): PriceObservation | null {
  const merchantKey = merchant.toLowerCase();
  let latest: PriceObservation | null = null;
  let latestAt = Number.NEGATIVE_INFINITY;
  for (const observation of feed.observations) {
    if (observation.sku !== sku) continue;
    if (observation.merchant.toLowerCase() !== merchantKey) continue;
    const observedAt = Date.parse(observation.observedAt);
    if (observedAt > now.getTime()) continue;
    const isLater = observedAt > latestAt;
    const isCheaperTie = observedAt === latestAt && latest !== null && observation.price < latest.price;
    if (isLater || isCheaperTie) {
      latest = observation;
      latestAt = observedAt;
    }
  }
  return latest;
}

/** Combines feeds (e.g. mock + email_promo observations). The result is simulated if any input is. */
export function mergeFeeds(...feeds: readonly PriceFeed[]): PriceFeed {
  return {
    simulated: feeds.some((feed) => feed.simulated),
    observations: feeds.flatMap((feed) => feed.observations),
  };
}
