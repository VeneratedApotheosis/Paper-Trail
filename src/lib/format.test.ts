import { describe, expect, it } from "vitest";
import { confidenceLabel, confidenceLevel } from "./format";

describe("confidenceLabel", () => {
  it("calls 90% and above Clear", () => {
    expect(confidenceLabel(0.9)).toBe("Clear");
    expect(confidenceLabel(1)).toBe("Clear");
  });

  it("calls 70% to 89% Probably right", () => {
    expect(confidenceLabel(0.89)).toBe("Probably right");
    expect(confidenceLabel(0.7)).toBe("Probably right");
  });

  it("calls anything below 70% Needs a quick check", () => {
    expect(confidenceLabel(0.69)).toBe("Needs a quick check");
    expect(confidenceLabel(0.62)).toBe("Needs a quick check");
    expect(confidenceLabel(0)).toBe("Needs a quick check");
  });

  it("never phrases confidence as odds of getting paid", () => {
    for (const conf of [0.2, 0.75, 0.95]) {
      expect(confidenceLabel(conf)).not.toMatch(/sure|chance|likely|paid|%/i);
    }
  });

  it("uses the same 70% line the review rules use", () => {
    expect(confidenceLevel(0.7)).not.toBe("needs_check");
    expect(confidenceLevel(0.6999)).toBe("needs_check");
  });
});
