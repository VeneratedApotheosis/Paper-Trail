import { describe, expect, it } from "vitest";
import { FindingSchema, type Finding, type NormalizedOrder } from "@/lib/contracts";
import { findingId, ruleVersionOf, runRules, severityFor, type Rule } from "./engine";
import { defaultRules } from "./index";
import { makeEvent, makeOrder } from "./test-helpers";

const NOW = new Date("2026-10-15T12:00:00.000Z");

function fakeFinding(order: NormalizedOrder, overrides: Partial<Finding>): Finding {
  return {
    id: "wrong-id",
    kind: "price_drop",
    orderId: order.id,
    amountAtStake: 10,
    currency: order.currency,
    dueAt: null,
    severity: "low",
    status: "open",
    ruleVersion: "T@1",
    summary: "Test finding.",
    evidence: [{ messageId: "msg-test", quote: "Test quote" }],
    explain: { rule: "price_drop" },
    simulated: true,
    ...overrides,
  };
}

function fixedRule(id: string, make: (order: NormalizedOrder) => Partial<Finding>[]): Rule {
  return {
    id,
    version: "1",
    evaluate: (order) => make(order).map((overrides) => fakeFinding(order, overrides)),
  };
}

describe("severityFor", () => {
  it.each([
    [0, "low"],
    [24.99, "low"],
    [25, "medium"],
    [99.99, "medium"],
    [100, "high"],
    [500, "high"],
  ] as const)("%d -> %s", (amount, severity) => {
    expect(severityFor(amount)).toBe(severity);
  });
});

describe("findingId / ruleVersionOf", () => {
  it("builds deterministic ids and rule versions", () => {
    expect(findingId("refund_overdue", "ord-1")).toBe("refund_overdue:ord-1");
    expect(findingId("price_drop", "ord-1", "li-2")).toBe("price_drop:ord-1:li-2");
    expect(ruleVersionOf({ id: "R1", version: "1" })).toBe("R1@1");
  });
});

describe("runRules", () => {
  it("de-duplicates by deterministic id and keeps the first finding", () => {
    const order = makeOrder();
    const first = fixedRule("A", () => [{ lineItemId: "li-socks", amountAtStake: 5 }]);
    const second = fixedRule("B", () => [{ lineItemId: "li-socks", amountAtStake: 50 }]);
    const findings = runRules([order], [first, second, first], { now: NOW });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ id: "price_drop:ord-1:li-socks", amountAtStake: 5 });
  });

  it("does not duplicate findings when the same rules run twice", () => {
    const order = makeOrder({ events: [makeEvent("return_received", "2026-09-20T12:00:00.000Z")] });
    const findings = runRules([order], [...defaultRules, ...defaultRules], { now: NOW });
    expect(findings.map((finding) => finding.id)).toEqual(["refund_overdue:ord-1"]);
  });

  it("sorts by dueAt ascending (nulls last), then amount descending", () => {
    const rule = fixedRule("S", (order) => {
      const byOrder: Record<string, Partial<Finding>> = {
        a: { dueAt: "2026-10-20T00:00:00.000Z", amountAtStake: 10 },
        b: { dueAt: "2026-10-18T00:00:00.000Z", amountAtStake: 5 },
        c: { dueAt: null, amountAtStake: 8 },
        d: { dueAt: null, amountAtStake: 50 },
        e: { dueAt: "2026-10-20T00:00:00.000Z", amountAtStake: 30 },
      };
      return [byOrder[order.id]];
    });
    const orders = ["a", "b", "c", "d", "e"].map((id) => makeOrder({ id }));
    const findings = runRules(orders, [rule], { now: NOW });
    expect(findings.map((finding) => finding.orderId)).toEqual(["b", "e", "a", "d", "c"]);
  });

  it("skips orders flagged needsReview", () => {
    const rule = fixedRule("A", () => [{}]);
    const orders = [makeOrder({ id: "ok" }), makeOrder({ id: "review", needsReview: true })];
    expect(runRules(orders, [rule], { now: NOW }).map((finding) => finding.orderId)).toEqual(["ok"]);
  });

  it("returns findings that all pass FindingSchema", () => {
    const orders = [
      makeOrder({ id: "overdue", events: [makeEvent("return_received", "2026-09-20T12:00:00.000Z")] }),
      makeOrder({
        id: "short",
        events: [
          makeEvent("return_received", "2026-09-20T12:00:00.000Z"),
          makeEvent("refund_issued", "2026-09-24T12:00:00.000Z", { amount: 90 }),
        ],
      }),
    ];
    const findings = runRules(orders, defaultRules, { now: NOW });
    expect(findings.map((finding) => finding.id)).toEqual(["refund_overdue:overdue", "refund_short:short"]);
    for (const finding of findings) expect(FindingSchema.parse(finding)).toEqual(finding);
  });

  it("throws when a rule produces an invalid finding", () => {
    const bad = fixedRule("BAD", () => [{ amountAtStake: -1 }]);
    expect(() => runRules([makeOrder()], [bad], { now: NOW })).toThrow(/BAD@1/);
  });

  it("passes the injected clock to rules", () => {
    const seen: Date[] = [];
    const spy: Rule = {
      id: "SPY",
      version: "1",
      evaluate: (_order, ctx) => {
        seen.push(ctx.now);
        return [];
      },
    };
    runRules([makeOrder()], [spy], { now: NOW });
    expect(seen).toEqual([NOW]);
  });
});
