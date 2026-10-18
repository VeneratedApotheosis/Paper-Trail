import { describe, expect, it } from "vitest";
import { decideKind, subscriptionIntervalOf, type KindEvidence } from "./kind";

const base: KindEvidence = {
  names: [], domains: [], text: "", shippingEvidence: false, recurringCharge: false,
  llmSubscriptionInterval: false, llmGuess: null, confMin: 0.95,
};
const kindOf = (evidence: Partial<KindEvidence>) => decideKind({ ...base, ...evidence }).kind;

describe("decideKind (#127): rules first, LLM guess as fallback", () => {
  it("food delivery and travel merchants win even with a 'delivered' email", () => {
    expect(kindOf({ names: ["DoorDash"], shippingEvidence: true })).toBe("food_delivery");
    expect(kindOf({ domains: ["ubereats.com"] })).toBe("food_delivery");
    expect(kindOf({ names: ["Delta Air Lines"], domains: ["delta.com"] })).toBe("travel");
    expect(kindOf({ names: ["Airbnb"] })).toBe("travel");
  });

  it("shipping or tracking evidence means shipped", () => {
    expect(kindOf({ names: ["Bowl Keyboards"], shippingEvidence: true })).toBe("shipped");
  });

  it("recurring billing means subscription, by wording or by a repeated charge", () => {
    expect(kindOf({ text: "your subscription has been renewed. next billing date: nov 1" })).toBe("subscription");
    expect(kindOf({ text: "感謝訂閱，每月自動續約" })).toBe("subscription");
    expect(kindOf({ recurringCharge: true })).toBe("subscription");
    expect(kindOf({ llmSubscriptionInterval: true })).toBe("subscription");
  });

  it("app stores are digital, convenience stores and POS platforms are in-store", () => {
    expect(kindOf({ names: ["Apple"], text: "receipt from the app store" })).toBe("digital");
    expect(kindOf({ domains: ["steampowered.com"] })).toBe("digital");
    expect(kindOf({ names: ["7-ELEVEN 統一超商"] })).toBe("in_store");
    expect(kindOf({ domains: ["squareup.com"] })).toBe("in_store");
  });

  it("uses the model's guess only with enough confidence, else other", () => {
    expect(kindOf({ llmGuess: "travel", confMin: 0.9 })).toBe("travel");
    expect(kindOf({ llmGuess: "travel", confMin: 0.5 })).toBe("other");
    expect(kindOf({})).toBe("other");
  });

  it("a rule beats a contradicting model guess", () => {
    expect(kindOf({ names: ["DoorDash"], llmGuess: "shipped" })).toBe("food_delivery");
  });
});

describe("subscriptionIntervalOf", () => {
  it("reads one interval, none when ambiguous", () => {
    expect(subscriptionIntervalOf("billed monthly")).toBe("month");
    expect(subscriptionIntervalOf("$99 per year")).toBe("year");
    expect(subscriptionIntervalOf("每週配送")).toBe("week");
    expect(subscriptionIntervalOf("monthly or annual")).toBeNull();
  });
});
