import { describe, expect, it } from "vitest";
import type { PriceFeed } from "./feed";
import { compareWishlistPrices } from "./wishlist";

const observation = (merchant: string, price: number, observedAt: string, sku = "SYN-1") =>
  ({ merchant, sku, name: "Synthetic Kettle", price, currency: "USD" as const, observedAt, source: "mock" as const });

const feed: PriceFeed = {
  simulated: true,
  observations: [
    observation("Grandmart", 40, "2026-10-01T00:00:00Z"),
    observation("Grandmart", 35, "2026-10-10T00:00:00Z"),
    observation("grandmart", 20, "2026-10-30T00:00:00Z"),
    observation("Voltline Electronics", 32.5, "2026-10-05T00:00:00Z"),
    observation("Northwind Outfitters", 50, "2026-10-02T00:00:00Z"),
    observation("Northwind Outfitters", 99, "2026-10-02T00:00:00Z", "SYN-2"),
  ],
};
const now = new Date("2026-10-17T00:00:00Z");

describe("compareWishlistPrices", () => {
  it("lists each store's latest price at now, cheapest first, ignoring future observations", () => {
    const [kettle] = compareWishlistPrices(feed, [{ sku: "SYN-1", name: "Kettle" }], now);
    expect(kettle.offers.map((offer) => [offer.merchant, offer.price])).toEqual([
      ["Voltline Electronics", 32.5], ["Grandmart", 35], ["Northwind Outfitters", 50],
    ]);
    expect(kettle.cheapest?.merchant).toBe("Voltline Electronics");
    expect(kettle.spread).toBe(17.5);
    expect(kettle.simulated).toBe(true);
  });

  it("returns no offers for an unknown sku and no spread for a single store", () => {
    const [unknown, single] = compareWishlistPrices(feed, [{ sku: "NOPE", name: "x" }, { sku: "SYN-2", name: "y" }], now);
    expect(unknown).toMatchObject({ offers: [], cheapest: null, spread: 0 });
    expect(single).toMatchObject({ spread: 0, cheapest: { price: 99 } });
  });
});
