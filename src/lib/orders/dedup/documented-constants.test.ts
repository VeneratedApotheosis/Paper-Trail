import { expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_EMAILS } from "@/lib/demo";
import { MAX_GMAIL_MESSAGES, MAX_PROMO_FETCH } from "@/lib/gmail/client";
import { LIVE_LLM_LIMIT, LIVE_LLM_WINDOW_MS } from "@/lib/api/rate-limit";
import { AMBIGUITY_MARGIN, AUTO_MERGE_SCORE, DEDUP_WEIGHTS, LIFECYCLE_WINDOW_DAYS, POSSIBLE_DUPLICATE_SCORE, RECURRING_MIN_GAP_DAYS } from "./score";

// The numbers quoted in docs/dedup.md, docs/gmail-sync.md and docs/api.md (#148). Changing one? Update the doc too.
it("dedup weights, thresholds and windows match docs/dedup.md", () => {
  expect(DEDUP_WEIGHTS).toEqual({
    exactCopy: 100, sharedRef: 70, merchant: 10, threadLifecycle: 30, threadConfirmation: 10, amountExact: 25, amountClose: 12,
    refundMatchesItem: 15, refundPartial: 5, amountAndTimingCombo: 15,
    itemsAllLifecycle: 40, itemsHalfLifecycle: 25, itemsAnyLifecycle: 10, itemsAllConfirmation: 30, itemsHalfConfirmation: 18, itemsAnyConfirmation: 8,
    gapDayConfirmation: 10, gapThreeDaysConfirmation: 6, gapWeekConfirmation: 2, gapWeekLifecycle: 10, gapWindowLifecycle: 5, sharedTracking: 90,
  });
  expect([AUTO_MERGE_SCORE, POSSIBLE_DUPLICATE_SCORE, AMBIGUITY_MARGIN, RECURRING_MIN_GAP_DAYS]).toEqual([60, 35, 10, 20]);
  expect(LIFECYCLE_WINDOW_DAYS).toEqual({ shipped: 30, delivered: 30, return_started: 90, return_received: 90, refund: 90, price_adjust: 90, cancel: 90 });
});

it("sync and upload caps match docs/gmail-sync.md and docs/api.md", () => {
  expect([MAX_GMAIL_MESSAGES, MAX_PROMO_FETCH]).toEqual([50, 100]);
  expect([MAX_UPLOAD_BYTES, MAX_UPLOAD_EMAILS]).toEqual([5 * 1024 * 1024, 300]);
  expect([LIVE_LLM_LIMIT, LIVE_LLM_WINDOW_MS]).toEqual([20, 10 * 60 * 1000]);
});
