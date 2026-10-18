import { describe, expect, it } from "vitest";
import { demoPromotionTexts } from "./demo";
import { promotionCandidates } from "./state";

describe("demo promotions", () => {
  it("every synthetic demo promotion is read as an offer, with soon-expiring ones before the as-of week ends", () => {
    const found = promotionCandidates(demoPromotionTexts());
    expect(found).toHaveLength(demoPromotionTexts().length);
    for (const { promotion } of found) expect(promotion.expiresAt, promotion.store).not.toBeNull();
    expect(found.some(({ promotion }) => promotion.codes.includes("GLOW15"))).toBe(true);
  });
});
