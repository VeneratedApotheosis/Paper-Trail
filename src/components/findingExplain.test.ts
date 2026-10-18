import { describe, expect, it } from "vitest";
import { explainConfidence, explainRows } from "./findingExplain";

describe("explainRows", () => {
  it("labels refund rule inputs in plain words and drops what the card already shows", () => {
    const rows = explainRows(
      {
        rule: "refund_overdue",
        summary: "ignored",
        triggerType: "strong",
        triggerAt: "2026-03-02T12:00:00.000Z",
        slaDays: 10,
        slaSource: "default",
        expectedBy: "2026-03-12T12:00:00.000Z",
        expectedAmount: 98,
        dates: [
          { label: "Return received", value: "2026-03-02T12:00:00.000Z" },
          { label: "Refund expected by", value: "2026-03-12T12:00:00.000Z" },
        ],
        confidence: 0.9,
        sourceQuote: "ignored",
      },
      "USD",
    );
    expect(rows).toEqual([
      { label: "Return received", value: "Mar 2, 2026" },
      { label: "Refund expected by", value: "Mar 12, 2026" },
      { label: "How we know the return arrived", value: "The store confirmed it got the return" },
      { label: "Days the store has to refund", value: "10" },
      { label: "Where that time limit came from", value: "A standard time limit (not in your emails)" },
      { label: "Refund we expected", value: "$98.00" },
    ]);
  });

  it("keeps unknown keys with a readable label instead of dropping them", () => {
    expect(explainRows({ someNewInput: 3 }, "USD")).toEqual([{ label: "Some new input", value: "3" }]);
  });
});

describe("explainConfidence", () => {
  it("reads the 0..1 confidence the rules store", () => {
    expect(explainConfidence({ confidence: 0.62 })).toBe(0.62);
    expect(explainConfidence({})).toBeNull();
    expect(explainConfidence({ confidence: "high" })).toBeNull();
  });
});
