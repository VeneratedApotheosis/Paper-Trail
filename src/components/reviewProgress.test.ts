import { describe, expect, it } from "vitest";
import { ordersLeftSentence, reviewProgress } from "@/components/reviewProgress";

describe("reviewProgress", () => {
  it("shows only the real queue length without a checked count", () => {
    expect(reviewProgress(3)).toEqual({ heading: "3 to check", percent: null });
    expect(reviewProgress(0)).toEqual({ heading: "All clear", percent: null });
  });

  it("shows 'x of y checked' only when a checked count is supplied", () => {
    expect(reviewProgress(3, 0)).toEqual({ heading: "0 of 3 checked", percent: 0 });
    expect(reviewProgress(1, 2)).toEqual({ heading: "2 of 3 checked", percent: 67 });
    expect(reviewProgress(0, 0)).toEqual({ heading: "All clear", percent: null });
  });

  it("words the queue length", () => {
    expect(ordersLeftSentence(0)).toBe("Nothing left to check");
    expect(ordersLeftSentence(1)).toBe("1 order left to check");
    expect(ordersLeftSentence(2)).toBe("2 orders left to check");
  });
});
