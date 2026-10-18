import { describe, expect, it } from "vitest";
import { claimActionLabel, confidenceBarPercent, emailCountLabel, orderConfidence, sourceCardText } from "@/components/views/orderDetailHelpers";
import { claimSteps } from "@/components/views/claimSteps";

describe("orderDetailHelpers", () => {
  it("uses the lowest finding confidence, else the order's own", () => {
    expect(orderConfidence({ confMin: 0.95 }, [{ explain: { confidence: 0.8 } }, { explain: { confidence: 0.9 } }])).toBe(0.8);
    expect(orderConfidence({ confMin: 0.95 }, [{ explain: {} }])).toBe(0.95);
    expect(orderConfidence({ confMin: 1.4 }, [])).toBe(1);
  });

  it("counts emails and names the mailbox only when known", () => {
    expect(emailCountLabel(1)).toBe("1 email");
    expect(emailCountLabel(2)).toBe("2 emails");
    expect(sourceCardText(2, [])).toBe("Read from 2 emails. Nothing is stored beyond these quotes.");
    expect(sourceCardText(1, [{ label: "a@x.com" }, { label: "b@y.com" }])).toBe(
      "Read from 1 email from a@x.com and b@y.com. Nothing is stored beyond these quotes.",
    );
  });

  it("clamps the confidence bar and picks the claim action by status", () => {
    expect(confidenceBarPercent(0.923)).toBe(92);
    expect(confidenceBarPercent(2)).toBe(100);
    expect(claimActionLabel("open")).toBe("Draft a claim");
    expect(claimActionLabel("drafted")).toBe("Open your claim");
    expect(claimActionLabel("resolved")).toBeNull();
  });
});

describe("claimSteps", () => {
  const states = (input: Parameters<typeof claimSteps>[0]) => claimSteps(input).map((s) => s.state);
  it("only moves past Approve once the server confirmed it", () => {
    expect(states({ approved: false, copyStatus: "idle", findingStatus: "open" })).toEqual(["current", "todo", "todo", "todo"]);
  });
  it("asks for a copy after approval until the copy worked", () => {
    expect(states({ approved: true, copyStatus: "idle", findingStatus: "drafted" })).toEqual(["done", "current", "todo", "todo"]);
    expect(states({ approved: true, copyStatus: "failed", findingStatus: "drafted" })).toEqual(["done", "current", "todo", "todo"]);
    expect(states({ approved: true, copyStatus: "copied", findingStatus: "drafted" })).toEqual(["done", "done", "current", "todo"]);
  });
  it("marks everything done when resolved", () => {
    expect(states({ approved: false, copyStatus: "idle", findingStatus: "resolved" })).toEqual(["done", "done", "done", "done"]);
  });
});
