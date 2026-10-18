import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listPromotions, recordSyncPromotions } from "@/lib/promotions/state";
import { createSyncCollector } from "./collector";
import { runUploadPipeline } from "@/lib/demo";
import { getState, resetStore, setPipelineResult } from "@/lib/store";
import { QualityError, markSkippedAsPromotion, markSkippedAsReceipt } from "./feedback";
import { classOverridesFor, createLabelStore, setLabelStore, type LabelStore } from "./labels";
import { getSkippedEmails, recordSyncQuality } from "./state";
import { NEWSLETTER, NOW, PROMO, fakeLlm, order } from "./test-helpers";

/** Skipped-list feedback added by #131: "This is a shipping update" and "This is a promotion". */
let labels: LabelStore;
beforeEach(() => { resetStore(); labels = createLabelStore(":memory:"); setLabelStore(labels); });
afterEach(() => { setLabelStore(undefined); resetStore(); });

const emails = () => [order("o1", "NW-1"), NEWSLETTER, PROMO];

/** An upload run with promotions recorded (rules only), like POST /api/upload with PROMO_LLM_LIMIT=0. */
async function publish() {
  const collector = createSyncCollector({ source: "upload", clock: () => NOW });
  const result = await runUploadPipeline(emails(), {
    cache: { get: () => undefined, set: () => undefined }, now: NOW, llm: fakeLlm(), observer: collector.observe,
    classOverride: classOverridesFor("anonymous"),
  });
  setPipelineResult("upload", NOW.toISOString(), result);
  const collected = collector.finish(result);
  recordSyncQuality(collected);
  await recordSyncPromotions(collected, { limit: 0, rules: { utcOffsetMinutes: () => 0 } }).enrichment;
  return result;
}

describe("this is a shipping update", () => {
  it("records class shipped (not order) and extracts the email as a shipping update", async () => {
    await publish();
    const result = await markSkippedAsReceipt("promo-1", { llm: fakeLlm(), class: "shipped", now: NOW });
    expect(result).toMatchObject({ emailId: "promo-1", class: "shipped", extracted: true, labeled: true });
    expect(labels.get("anonymous", "promo-1")).toMatchObject({ class: "shipped", source: "feedback" });
    expect(getSkippedEmails().map((entry) => entry.emailId)).toEqual(["news-1"]);
  });

  it("takes the email off the Promotions page", async () => {
    await publish();
    expect(listPromotions({ now: NOW }).promotions.map((promotion) => promotion.id)).toEqual(["promo-1"]);
    await markSkippedAsReceipt("promo-1", { llm: fakeLlm(), class: "shipped", now: NOW });
    expect(listPromotions({ now: NOW }).total).toBe(0);
  });

  it("is applied on the next run: the class override makes it a shipping update, not a promotion", async () => {
    await publish();
    await markSkippedAsReceipt("promo-1", { llm: fakeLlm(), class: "shipped", now: NOW });
    const result = await publish();
    expect(result.stats.classes.shipped).toBe(1);
    expect(listPromotions({ now: NOW }).total).toBe(0);
  });
});

describe("this is a promotion", () => {
  it("lists a skipped email on the Promotions page, saves a marketing label, audits it and unlists it from skipped", async () => {
    await publish();
    expect(getSkippedEmails().map((entry) => [entry.emailId, entry.reason])).toEqual([["news-1", "prefilter"], ["promo-1", "marketing"]]);
    const result = markSkippedAsPromotion("news-1", { now: NOW });
    expect(result).toMatchObject({ emailId: "news-1", labeled: true, promotion: { id: "news-1", store: "The Oakhaven Journal", source: "rules" } });
    expect(labels.get("anonymous", "news-1")).toMatchObject({ class: "marketing", source: "feedback", fields: null });
    expect(getSkippedEmails().map((entry) => entry.emailId)).toEqual(["promo-1"]);
    expect(getState().audit.some((entry) => entry.type === "approval" && entry.detail.includes("Marked email news-1 as a promotion"))).toBe(true);
    expect(listPromotions({ now: NOW }).promotions.map((promotion) => promotion.id).sort()).toEqual(["news-1", "promo-1"]);
  });

  it("is applied on the next run: the email stays a promotion even without an offer", async () => {
    await publish();
    markSkippedAsPromotion("news-1", { now: NOW });
    await publish();
    expect(listPromotions({ now: NOW }).promotions.map((promotion) => promotion.id)).toContain("news-1");
  });

  it("refuses an email that is not in the skipped list", async () => {
    await publish();
    expect(() => markSkippedAsPromotion("o1", { now: NOW })).toThrow(QualityError);
    expect(() => markSkippedAsPromotion("nope", { now: NOW })).toThrowError(/not in the skipped list/);
  });
});
