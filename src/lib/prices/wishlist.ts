import { latestPrice, type PriceFeed, type PriceObservation } from "./feed";

/** One item the user wants to buy (F4.1 wishlist, issue #19 stub). Matched exactly against feed skus. */
export interface WishlistItem {
  sku: string;
  name: string;
}

export interface WishlistComparison {
  item: WishlistItem;
  /** Latest price per store at `now`, cheapest first (ties: merchant name). Empty when no store has the sku. */
  offers: PriceObservation[];
  cheapest: PriceObservation | null;
  /** cheapest vs the dearest offer, in major units; 0 with fewer than two offers. */
  spread: number;
  /** True when the feed is simulated (mock feed): the UI must label these prices "simulated". */
  simulated: boolean;
}

/**
 * Stub for F4.1 wishlist price comparison: compares each item's latest price across every store in `feed`.
 * Pure (takes `now`); prices come only from the feed, never from an LLM.
 */
export function compareWishlistPrices(feed: PriceFeed, items: readonly WishlistItem[], now: Date): WishlistComparison[] {
  return items.map((item) => {
    const merchants = new Map<string, string>();
    for (const observation of feed.observations) {
      if (observation.sku === item.sku) merchants.set(observation.merchant.toLowerCase(), observation.merchant);
    }
    const offers = [...merchants.values()]
      .map((merchant) => latestPrice(feed, merchant, item.sku, now))
      .filter((offer): offer is PriceObservation => offer !== null)
      .sort((a, b) => a.price - b.price || a.merchant.localeCompare(b.merchant));
    const cheapest = offers[0] ?? null;
    const spread = offers.length > 1 ? Math.round((offers[offers.length - 1].price - offers[0].price) * 100) / 100 : 0;
    return { item, offers, cheapest, spread, simulated: feed.simulated };
  });
}
