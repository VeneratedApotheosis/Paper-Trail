import { describe, expect, it } from "vitest";
import { findCodes, hasOffer, normalizeExpiry, promotionFrom, readPromotion, resolveExpiry, storeDomainOf, type PromotionEmail } from "./rules";

/** Synthetic marketing emails: fictional stores on reserved .example domains. */
const UTC = { utcOffsetMinutes: () => 0 };
const PACIFIC = { utcOffsetMinutes: () => -420 };
// Saturday 2026-10-17 15:00 UTC.
const SENT = "2026-10-17T15:00:00.000Z";

function email(subject: string, text: string, extra: Partial<PromotionEmail> = {}): PromotionEmail {
  return { emailId: "m1", fromName: "Lumen Beauty", fromDomain: "e.lumenbeauty.example", subject, date: SENT, text, ...extra };
}

describe("readPromotion: offers", () => {
  it("reads a pickup offer with a minimum spend that ends tonight", () => {
    const reading = readPromotion(email("Ends tonight! Get $10 off your $40 order when you pick it up at the store", "Show this email in store. Unsubscribe any time."), UTC);
    expect(reading.discount).toEqual({ kind: "amount", value: 10, currency: "USD", minSpend: 40 });
    expect(reading.headline).toBe("$10 off a $40 pickup order");
    expect(reading.expiresAt).toBe("2026-10-17T23:59:00.000Z");
    expect(reading.channel).toBe("in_store");
    expect(reading.codes).toEqual([]);
    expect(reading.store).toBe("Lumen Beauty");
    expect(reading.storeDomain).toBe("lumenbeauty.example");
  });

  it("reads a percent offer with a code", () => {
    const reading = readPromotion(email("Fall into savings", "Take 20% off everything online. Use code FALL20 at checkout. Offer ends Oct 20."), UTC);
    expect(reading.discount).toEqual({ kind: "percent", value: 20, currency: null, minSpend: null });
    expect(reading.codes).toEqual(["FALL20"]);
    expect(reading.expiresAt).toBe("2026-10-20T23:59:00.000Z");
    expect(reading.headline).toBe("20% off");
    expect(reading.channel).toBe("online");
  });

  it("reads a minimum spend on a percent offer, free shipping and buy one get one", () => {
    expect(readPromotion(email("Sale", "25% off orders over $75 this weekend."), UTC).discount).toEqual({ kind: "percent", value: 25, currency: "USD", minSpend: 75 });
    const shipping = readPromotion(email("Free shipping", "Free shipping on orders over $50, no code needed."), UTC);
    expect(shipping.discount).toEqual({ kind: "free_shipping", value: null, currency: "USD", minSpend: 50 });
    expect(shipping.headline).toBe("Free shipping on orders over $50");
    const bogo = readPromotion(email("BOGO socks", "Buy one, get one free on all socks."), UTC);
    expect(bogo.discount?.kind).toBe("bogo");
    expect(bogo.headline).toBe("Buy one, get one");
    expect(readPromotion(email("Thanks", "Spend $60 and save $12 on your next visit."), UTC).discount).toMatchObject({ kind: "amount", value: 12, minSpend: 60 });
  });

  it("does not take a free-shipping minimum as the discount's minimum spend", () => {
    const reading = readPromotion(email("Fall into savings", "Take 20% off everything online. Use code FALL20. Free shipping on orders over $75. Sale ends Oct 20."), UTC);
    expect(reading.discount).toEqual({ kind: "percent", value: 20, currency: null, minSpend: null });
    expect(reading.headline).toBe("20% off");
    const chinese = readPromotion(email("全館8折", "全館8折，滿1000元免運。"), UTC);
    expect(chinese.discount).toEqual({ kind: "percent", value: 20, currency: null, minSpend: null });
    expect(readPromotion(email("Sale", "Free shipping on orders over $75, plus $10 off orders over $50."), UTC).discount).toMatchObject({ kind: "amount", value: 10, minSpend: 50 });
  });

  it("keeps a plain newsletter free of offer signals and falls back to the subject", () => {
    const reading = readPromotion(email("Five ways to layer textures", "This month in the Journal. Unsubscribe any time."), UTC);
    expect(reading.discount).toBeNull();
    expect(hasOffer(reading)).toBe(false);
    expect(reading.headline).toBe("Five ways to layer textures");
  });

  it("reads Traditional Chinese offers", () => {
    const folded = readPromotion(email("秋季限時優惠 全館8折", "輸入優惠碼 AUTUMN88 享全館8折，今晚截止。免運費。"), UTC);
    expect(folded.discount).toEqual({ kind: "percent", value: 20, currency: null, minSpend: null });
    expect(folded.codes).toEqual(["AUTUMN88"]);
    expect(folded.expiresAt).toBe("2026-10-17T23:59:00.000Z");
    const amount = readPromotion(email("滿額現折", "折扣碼：SAVE50 滿$500折$50，10月25日截止。"), UTC);
    expect(amount.discount).toEqual({ kind: "amount", value: 50, currency: "USD", minSpend: 500 });
    expect(amount.codes).toEqual(["SAVE50"]);
    expect(amount.expiresAt).toBe("2026-10-25T23:59:00.000Z");
    expect(readPromotion(email("免運", "滿1000元免運，限時三天"), UTC).discount).toMatchObject({ kind: "free_shipping", minSpend: 1000 });
    expect(readPromotion(email("85折", "會員專屬85折"), UTC).discount).toMatchObject({ kind: "percent", value: 15 });
  });

  it("builds a Promotion from a reading", () => {
    const reading = readPromotion(email("20% off with code FALL20", ""), UTC);
    const promotion = promotionFrom({ ...email("x", ""), accountId: "acct-1" }, reading, "rules");
    expect(promotion).toMatchObject({ id: "m1", emailIds: ["m1"], accountId: "acct-1", source: "rules", codes: ["FALL20"] });
    expect(promotion.confidence).toBeGreaterThan(0.5);
    expect(promotion.confidence).toBeLessThanOrEqual(0.85);
  });
});

describe("findCodes", () => {
  it.each([
    ["Use code FALL20 at checkout", ["FALL20"]],
    ["promo code: SAVE-10.", ["SAVE-10"]],
    ["Enter the code “WELCOME15” to redeem", ["WELCOME15"]],
    ["Coupon code = Spring25", ["Spring25"]],
    ["code FIRST and coupon BONUS5", ["FIRST", "BONUS5"]],
    ["優惠碼：ＦＡＬＬ２０", ["FALL20"]],
  ])("finds the code in %s", (text, codes) => {
    expect(findCodes(text)).toEqual(codes);
  });

  it.each([
    "Use code at checkout",
    "No code needed",
    "Enter your code below",
    "promo code 12345",
    "Download our code of conduct",
  ])("finds no code in %s", (text) => {
    expect(findCodes(text)).toEqual([]);
  });
});

describe("resolveExpiry", () => {
  const at = (text: string, options = UTC) => resolveExpiry(text, SENT, options);

  it("resolves tonight and today to 23:59 of the email's local day", () => {
    expect(at("Sale ends tonight")).toBe("2026-10-17T23:59:00.000Z");
    expect(at("Today only: 30% off")).toBe("2026-10-17T23:59:00.000Z");
    // 2026-10-17T15:00Z is still the 17th in Pacific time (08:00); 23:59 PDT is 06:59Z the next day.
    expect(at("ends tonight", PACIFIC)).toBe("2026-10-18T06:59:00.000Z");
    // 2026-10-18T02:00Z is the evening of the 17th in Pacific time.
    expect(resolveExpiry("ends tonight", "2026-10-18T02:00:00.000Z", PACIFIC)).toBe("2026-10-18T06:59:00.000Z");
  });

  it.each([
    ["ends tomorrow", "2026-10-18T23:59:00.000Z"],
    ["Offer valid through Sunday", "2026-10-18T23:59:00.000Z"],
    ["ends Saturday", "2026-10-17T23:59:00.000Z"],
    ["expires next Saturday", "2026-10-24T23:59:00.000Z"],
    ["Ends Oct 20", "2026-10-20T23:59:00.000Z"],
    ["valid until October 31st, 2026", "2026-10-31T23:59:00.000Z"],
    ["ends 20 October", "2026-10-20T23:59:00.000Z"],
    ["expires 10/22", "2026-10-22T23:59:00.000Z"],
    ["through 11/1/2026", "2026-11-01T23:59:00.000Z"],
    ["valid through 2026-12-01", "2026-12-01T23:59:00.000Z"],
    ["Ends Jan 3", "2027-01-03T23:59:00.000Z"],
    ["ends in 48 hours", "2026-10-19T15:00:00.000Z"],
    ["Hurry, ends in 3 days", "2026-10-20T23:59:00.000Z"],
    ["only 6 hours left", "2026-10-17T21:00:00.000Z"],
    ["今晚截止", "2026-10-17T23:59:00.000Z"],
    ["明天截止", "2026-10-18T23:59:00.000Z"],
    ["活動至10月25日", "2026-10-25T23:59:00.000Z"],
    ["10/30截止", "2026-10-30T23:59:00.000Z"],
    ["本週日截止", "2026-10-18T23:59:00.000Z"],
    ["限時48小時", "2026-10-19T15:00:00.000Z"],
  ])("resolves '%s'", (text, expected) => {
    expect(at(text)).toBe(expected);
  });

  it("takes the earliest phrase and ignores text without an end", () => {
    expect(at("Ends tonight! Terms: valid through Dec 31, 2026.")).toBe("2026-10-17T23:59:00.000Z");
    expect(at("Our spring collection has arrived")).toBeNull();
    expect(at("Ends Feb 31")).toBeNull();
    expect(resolveExpiry("ends tonight", "not a date", UTC)).toBeNull();
  });

  it("normalizes Claude's dates: a bare date ends at 23:59, a date-time is kept", () => {
    expect(normalizeExpiry("2026-10-20", SENT, UTC)).toBe("2026-10-20T23:59:00.000Z");
    expect(normalizeExpiry("2026-10-20T18:30:00-07:00", SENT, UTC)).toBe("2026-10-21T01:30:00.000Z");
    expect(normalizeExpiry("soon", SENT, UTC)).toBeNull();
    expect(normalizeExpiry("2026-02-31", SENT, UTC)).toBeNull();
  });
});

describe("storeDomainOf", () => {
  it("drops subdomains, keeps two-part public suffixes and ignores mail services", () => {
    expect(storeDomainOf("e.ulta.com")).toBe("ulta.com");
    expect(storeDomainOf("mail.shop.example.co.uk")).toBe("example.co.uk");
    expect(storeDomainOf("bounce.sendgrid.net")).toBeNull();
    expect(storeDomainOf(null)).toBeNull();
  });
});
