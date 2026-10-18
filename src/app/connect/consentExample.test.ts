import { describe, expect, it } from "vitest";
import expected from "../../../seed/expected_findings.json";
import { CONSENT_EXAMPLE } from "./consentExample";

const KIND_LABEL: Record<string, string> = {
  refund_overdue: "Refund overdue",
  return_deadline: "Return window closing",
  price_drop: "Price drop",
};

describe("CONSENT_EXAMPLE", () => {
  it("only shows findings that exist in the synthetic seed, with their seed amounts", () => {
    const seedRows = new Set(
      expected.findings.map((finding) => `${KIND_LABEL[finding.kind] ?? finding.kind}, ${finding.merchant}|${finding.amountAtStake}`),
    );
    for (const item of CONSENT_EXAMPLE.items) expect(seedRows).toContain(`${item.label}|${item.amount}`);
  });

  it("totals its rows", () => {
    expect(CONSENT_EXAMPLE.total).toBe(337.72);
    expect(CONSENT_EXAMPLE.currency).toBe("USD");
  });
});
