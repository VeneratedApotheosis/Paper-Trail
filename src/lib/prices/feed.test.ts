import { describe, expect, it } from "vitest";
import {
  latestPrice,
  mergeFeeds,
  PriceFeedSchema,
  PriceObservationSchema,
  type PriceFeed,
  type PriceObservation,
} from "./feed";

/** Synthetic observations; all merchants and products are fictional. */
function observation(overrides: Partial<PriceObservation> = {}): PriceObservation {
  return {
    merchant: "Northwind Outfitters",
    sku: "NW-RJ-1",
    name: "Rain Jacket",
    price: 80,
    currency: "USD",
    observedAt: "2026-09-05T00:00:00.000Z",
    source: "mock",
    ...overrides,
  };
}

const feedOf = (...observations: PriceObservation[]): PriceFeed => ({ simulated: true, observations });
const NOW = new Date("2026-09-10T00:00:00.000Z");

describe("PriceFeedSchema", () => {
  it("parses the seed/price-feed.json format and defaults source to mock", () => {
    const feed = PriceFeedSchema.parse({
      simulated: true,
      observations: [
        {
          merchant: "Northwind Outfitters",
          sku: "NW-RJ-1",
          name: "Rain Jacket",
          price: 69.5,
          currency: "USD",
          observedAt: "2026-09-05T00:00:00Z",
        },
      ],
    });
    expect(feed.observations[0].source).toBe("mock");
  });

  it("keeps an explicit email_promo source", () => {
    expect(PriceObservationSchema.parse(observation({ source: "email_promo" })).source).toBe("email_promo");
  });

  it.each([
    ["negative price", { price: -1 }],
    ["non-ISO currency", { currency: "usd" }],
    ["non-datetime observedAt", { observedAt: "2026-09-05" }],
  ])("rejects %s", (_name, overrides) => {
    expect(PriceObservationSchema.safeParse({ ...observation(), ...overrides }).success).toBe(false);
  });
});

describe("latestPrice", () => {
  it("returns null when nothing matches", () => {
    expect(latestPrice(feedOf(), "Northwind Outfitters", "NW-RJ-1", NOW)).toBeNull();
    expect(latestPrice(feedOf(observation({ sku: "OTHER" })), "Northwind Outfitters", "NW-RJ-1", NOW)).toBeNull();
    expect(latestPrice(feedOf(observation({ merchant: "Other Store" })), "Northwind Outfitters", "NW-RJ-1", NOW)).toBeNull();
  });

  it("matches merchant names case-insensitively and skus exactly", () => {
    const feed = feedOf(observation({ merchant: "NORTHWIND outfitters" }));
    expect(latestPrice(feed, "Northwind Outfitters", "NW-RJ-1", NOW)?.price).toBe(80);
    expect(latestPrice(feed, "Northwind Outfitters", "nw-rj-1", NOW)).toBeNull();
  });

  it("returns the latest observation at or before now and ignores future ones", () => {
    const feed = feedOf(
      observation({ price: 75, observedAt: "2026-09-08T00:00:00.000Z" }),
      observation({ price: 70, observedAt: "2026-09-10T00:00:00.000Z" }),
      observation({ price: 72, observedAt: "2026-09-02T00:00:00.000Z" }),
      observation({ price: 50, observedAt: "2026-09-10T00:00:01.000Z" }),
    );
    expect(latestPrice(feed, "Northwind Outfitters", "NW-RJ-1", NOW)?.price).toBe(70);
  });

  it("breaks ties at the same instant with the lowest price", () => {
    const feed = feedOf(observation({ price: 75 }), observation({ price: 71 }), observation({ price: 73 }));
    expect(latestPrice(feed, "Northwind Outfitters", "NW-RJ-1", NOW)?.price).toBe(71);
  });

  it("compares instants, not strings, across time zone offsets", () => {
    const feed = feedOf(
      observation({ price: 75, observedAt: "2026-09-08T00:00:00.000Z" }),
      observation({ price: 70, observedAt: "2026-09-07T20:00:00.000-05:00" }),
    );
    expect(latestPrice(feed, "Northwind Outfitters", "NW-RJ-1", NOW)?.price).toBe(70);
  });
});

describe("mergeFeeds", () => {
  it("concatenates observations and is simulated if any input is", () => {
    const mock = feedOf(observation({ price: 75 }));
    const promo: PriceFeed = {
      simulated: false,
      observations: [observation({ price: 70, source: "email_promo", observedAt: "2026-09-06T00:00:00.000Z" })],
    };
    const merged = mergeFeeds(mock, promo);
    expect(merged.simulated).toBe(true);
    expect(merged.observations).toHaveLength(2);
    expect(latestPrice(merged, "Northwind Outfitters", "NW-RJ-1", NOW)?.source).toBe("email_promo");
  });

  it("is not simulated when no input is", () => {
    expect(mergeFeeds()).toEqual({ simulated: false, observations: [] });
    expect(mergeFeeds({ simulated: false, observations: [] }).simulated).toBe(false);
  });
});
