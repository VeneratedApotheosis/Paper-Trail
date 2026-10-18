import { describe, expect, it } from "vitest";
import { promotionsDesignFixture, promotionsEndedFixture, PROMOTIONS_FIXTURE_NOW } from "@/components/views/fixtures/promotions";
import { channelCounts, countText, endingSoon, minSpendLine, noCodeLine, splitByExpiry, storeRows } from "./promotionDisplay";

const now = new Date(PROMOTIONS_FIXTURE_NOW);
const all = [...promotionsDesignFixture, ...promotionsEndedFixture];

describe("promotionDisplay", () => {
  it("splits active from expired and keeps the given order", () => {
    const { active, expired } = splitByExpiry(all, now);
    expect(active.map((p) => p.id)).toEqual(["d1", "d2", "d3", "d4", "d5"]);
    expect(expired.map((p) => p.id)).toEqual(["d6", "d7"]);
  });

  it("counts channels, with an offer for both counting for each", () => {
    expect(channelCounts(promotionsDesignFixture)).toEqual({ all: 5, online: 4, in_store: 2 });
  });

  it("words the count for the header", () => {
    expect(countText(5, 5, false, false)).toBe("5 active");
    expect(countText(1, 5, false, true)).toBe("1 of 5 active offers");
    expect(countText(7, 7, true, false)).toBe("7 shown");
    expect(countText(7, 7, true, true)).toBe("7 offers shown");
  });

  it("lists what ends soonest with a short chip, never expired offers", () => {
    const items = endingSoon(all, now);
    expect(items.map((item) => [item.store, item.chip, item.urgent])).toEqual([
      ["FreshCart Grocery", "Tonight", true],
      ["Northwind Outfitters", "3 days", false],
      ["Voltline Electronics", "6 days", false],
      ["Brewbox Coffee", "15 days", false],
    ]);
    expect(items[0].month).toBe("OCT");
  });

  it("lists stores with active offers first, then stores that only have ended ones", () => {
    expect(storeRows(all, now).map((row) => [row.store, row.active])).toEqual([
      ["Brewbox Coffee", 1], ["FreshCart Grocery", 1], ["Lumen Beauty", 1], ["Northwind Outfitters", 1], ["Voltline Electronics", 1],
      ["Bazaarly", 0], ["Grandmart", 0],
    ]);
  });

  it("writes the minimum spend and the no-code line plainly", () => {
    expect(minSpendLine(null)).toBeNull();
    expect(minSpendLine({ kind: "percent", value: 20, currency: null, minSpend: null })).toBe("No minimum spend");
    expect(minSpendLine({ kind: "amount", value: 10, currency: "USD", minSpend: 40 })).toBe("Minimum spend $40");
    expect(noCodeLine(promotionsDesignFixture[2], false)).toBe("No code needed. Applied at checkout.");
    expect(noCodeLine(promotionsEndedFixture[1], true)).toBe("No code was needed");
    expect(noCodeLine(promotionsDesignFixture[4], false)).toBe("No code found in the email");
  });
});