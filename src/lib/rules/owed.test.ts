import { describe, expect, it } from "vitest";
import type { Finding, FindingStatus } from "@/lib/contracts";
import { computeOwed, countsTowardOwed, orderNeedsReview } from "./owed";
import { makeOrder } from "./test-helpers";

/** Synthetic refund_overdue finding on `orderId`. */
function makeFinding(id: string, amountAtStake: number, overrides: Partial<Finding> = {}): Finding {
  return {
    id,
    kind: "refund_overdue",
    orderId: "ord-1",
    amountAtStake,
    currency: "USD",
    dueAt: null,
    severity: "medium",
    status: "open",
    ruleVersion: "R1@1",
    summary: "Synthetic finding",
    evidence: [{ messageId: "msg-order", quote: "Synthetic quote" }],
    explain: {},
    simulated: false,
    ...overrides,
  };
}

const confirmed = makeOrder({ id: "ord-1" });
const lowConfidence = makeOrder({ id: "ord-low", confMin: 0.5 });
const flagged = makeOrder({ id: "ord-flagged", needsReview: true });

describe("orderNeedsReview", () => {
  it("flags matcher-flagged and low-confidence orders, not confident ones", () => {
    expect(orderNeedsReview(confirmed)).toBe(false);
    expect(orderNeedsReview(lowConfidence)).toBe(true);
    expect(orderNeedsReview(flagged)).toBe(true);
  });

  it("clears low confidence once a human confirmed the order (review.confirmedAt, #47)", () => {
    const reviewed = { ...lowConfidence, review: { revision: "r1", confirmedAt: "2026-10-17T00:00:00.000Z" } };
    expect(orderNeedsReview(reviewed)).toBe(false);
    expect(orderNeedsReview({ ...reviewed, needsReview: true })).toBe(true);
  });
});

describe("countsTowardOwed", () => {
  it.each<[FindingStatus, boolean]>([
    ["open", true],
    ["drafted", true],
    ["resolved", false],
    ["dismissed", false],
  ])("status %s on a confirmed order counts: %s", (status, expected) => {
    expect(countsTowardOwed(makeFinding("f", 10, { status }), confirmed)).toBe(expected);
  });

  it("never counts findings on needs-review or missing orders", () => {
    expect(countsTowardOwed(makeFinding("f", 10, { orderId: lowConfidence.id }), lowConfidence)).toBe(false);
    expect(countsTowardOwed(makeFinding("f", 10, { status: "drafted" }), flagged)).toBe(false);
    expect(countsTowardOwed(makeFinding("f", 10), undefined)).toBe(false);
  });
});

describe("computeOwed", () => {
  it("returns zeros for an empty ledger", () => {
    expect(computeOwed([], [])).toEqual({
      currency: "USD",
      owedTotal: 0,
      findingCount: 0,
      claimSentCount: 0,
      claimSentTotal: 0,
      excludedCount: 0,
      excludedTotal: 0,
    });
  });

  it("counts open and drafted findings; drafted ones are also the claim-sent subset", () => {
    const findings = [
      makeFinding("open", 40),
      makeFinding("drafted", 25.5, { status: "drafted" }),
      makeFinding("resolved", 100, { status: "resolved" }),
      makeFinding("dismissed", 7, { status: "dismissed" }),
    ];
    expect(computeOwed(findings, [confirmed])).toEqual({
      currency: "USD",
      owedTotal: 65.5,
      findingCount: 2,
      claimSentCount: 1,
      claimSentTotal: 25.5,
      excludedCount: 0,
      excludedTotal: 0,
    });
  });

  it("holds open and drafted findings on needs-review orders in the excluded bucket", () => {
    const findings = [
      makeFinding("ok", 10),
      makeFinding("low-open", 20, { orderId: lowConfidence.id }),
      makeFinding("flagged-drafted", 30, { orderId: flagged.id, status: "drafted" }),
      makeFinding("low-resolved", 99, { orderId: lowConfidence.id, status: "resolved" }),
    ];
    expect(computeOwed(findings, [confirmed, lowConfidence, flagged])).toMatchObject({
      owedTotal: 10,
      findingCount: 1,
      claimSentCount: 0,
      claimSentTotal: 0,
      excludedCount: 2,
      excludedTotal: 50,
    });
  });

  it("counts a low-confidence order's findings once review.confirmedAt is set", () => {
    const reviewed = { ...lowConfidence, review: { revision: "r1", confirmedAt: "2026-10-17T00:00:00.000Z" } };
    const findings = [makeFinding("low-open", 20, { orderId: reviewed.id })];
    expect(computeOwed(findings, [reviewed])).toMatchObject({ owedTotal: 20, findingCount: 1, excludedCount: 0 });
  });

  it("rounds every total to cents", () => {
    const findings = [
      makeFinding("a", 0.1),
      makeFinding("b", 0.2, { status: "drafted" }),
      makeFinding("c", 0.1, { status: "drafted" }),
      makeFinding("d", 0.1, { orderId: lowConfidence.id }),
      makeFinding("e", 0.2, { orderId: lowConfidence.id }),
    ];
    expect(computeOwed(findings, [confirmed, lowConfidence])).toMatchObject({
      owedTotal: 0.4,
      claimSentTotal: 0.3,
      excludedTotal: 0.3,
    });
  });

  it("labels totals with the first counted finding's currency (mixed currencies are a known follow-up)", () => {
    const findings = [
      makeFinding("eur-review", 5, { orderId: lowConfidence.id, currency: "EUR" }),
      makeFinding("gbp", 10, { currency: "GBP" }),
      makeFinding("usd", 1),
    ];
    // Amounts are not converted: 10 GBP + 1 USD is reported as 11 GBP until per-currency totals exist.
    expect(computeOwed(findings, [confirmed, lowConfidence])).toMatchObject({ currency: "GBP", owedTotal: 11 });
  });
});
