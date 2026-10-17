import { describe, expect, it } from "vitest";
import { FindingSchema, type Finding, type NormalizedOrder } from "@/lib/contracts";
import { runRules } from "./engine";
import { expectedRefundAmount, refundRule, type RefundExplain } from "./refund";
import { makeEvent, makeOrder, makePolicy } from "./test-helpers";

const RECEIVED_AT = "2026-09-20T12:00:00.000Z";
const received = (overrides: Parameters<typeof makeEvent>[2] = {}) =>
  makeEvent("return_received", RECEIVED_AT, overrides);
const refund = (amount: number | null, at = "2026-09-24T12:00:00.000Z") =>
  makeEvent("refund_issued", at, { amount });

const singleItemOrder = (total: number): Partial<NormalizedOrder> => ({
  subtotal: total,
  tax: 0,
  shipping: 0,
  total,
  lineItems: [{ id: "li-mug", name: "Mug", qty: 1, unitPrice: total, returnedQty: 0 }],
});

interface RefundCase {
  name: string;
  order: NormalizedOrder;
  now: string;
  expected: null | {
    kind: Finding["kind"];
    amountAtStake: number;
    dueAt: string | null;
    severity?: Finding["severity"];
    explain?: Partial<RefundExplain>;
  };
}

const cases: RefundCase[] = [
  {
    name: "overdue after strong trigger + default 10-day SLA",
    order: makeOrder({ events: [received()] }),
    now: "2026-10-01T12:00:00.000Z",
    expected: {
      kind: "refund_overdue",
      amountAtStake: 113,
      dueAt: "2026-09-30T12:00:00.000Z",
      severity: "high",
      explain: { triggerType: "strong", slaDays: 10, slaSource: "default", expectedAmount: 113 },
    },
  },
  {
    name: "overdue after weak trigger (drop-off) + default 14-day SLA",
    order: makeOrder({ events: [makeEvent("return_dropped", "2026-09-15T12:00:00.000Z")] }),
    now: "2026-10-01T12:00:00.000Z",
    expected: {
      kind: "refund_overdue",
      amountAtStake: 113,
      dueAt: "2026-09-29T12:00:00.000Z",
      explain: { triggerType: "weak", slaDays: 14, triggerAt: "2026-09-15T12:00:00.000Z" },
    },
  },
  {
    name: "weak trigger (return started) 11 days ago is not yet overdue",
    order: makeOrder({ events: [makeEvent("return_started", RECEIVED_AT)] }),
    now: "2026-10-01T12:00:00.000Z",
    expected: null,
  },
  {
    name: "not yet due",
    order: makeOrder({ events: [received()] }),
    now: "2026-09-23T12:00:00.000Z",
    expected: null,
  },
  {
    name: "due-soon window (E-2d) emits no finding",
    order: makeOrder({ events: [received()] }),
    now: "2026-09-28T12:00:00.000Z",
    expected: null,
  },
  {
    name: "exactly at E emits no finding (overdue needs now > E)",
    order: makeOrder({ events: [received()] }),
    now: "2026-09-30T12:00:00.000Z",
    expected: null,
  },
  {
    name: "matched full refund",
    order: makeOrder({ events: [received(), refund(113)] }),
    now: "2026-10-15T12:00:00.000Z",
    expected: null,
  },
  {
    name: "store credit counts as matched",
    order: makeOrder({
      events: [received(), makeEvent("store_credit", "2026-09-24T12:00:00.000Z", { amount: 50 })],
    }),
    now: "2026-10-15T12:00:00.000Z",
    expected: null,
  },
  {
    name: "short refund beyond tolerance",
    order: makeOrder({ events: [received(), refund(100)] }),
    now: "2026-10-15T12:00:00.000Z",
    expected: {
      kind: "refund_short",
      amountAtStake: 13,
      dueAt: null,
      severity: "low",
      explain: { expectedAmount: 113, refundedAmount: 100, tolerance: 2.26 },
    },
  },
  {
    name: "short refund within 2% tolerance",
    order: makeOrder({ events: [received(), refund(111)] }),
    now: "2026-10-15T12:00:00.000Z",
    expected: null,
  },
  {
    name: "short by exactly the $0.50 floor is within tolerance",
    order: makeOrder({ ...singleItemOrder(20), events: [received(), refund(19.5)] }),
    now: "2026-10-15T12:00:00.000Z",
    expected: null,
  },
  {
    name: "short by $0.51 exceeds the $0.50 floor",
    order: makeOrder({ ...singleItemOrder(20), events: [received(), refund(19.49)] }),
    now: "2026-10-15T12:00:00.000Z",
    expected: { kind: "refund_short", amountAtStake: 0.51, dueAt: null, explain: { tolerance: 0.5 } },
  },
  {
    name: "partial return expects returned items + prorated tax",
    order: makeOrder({ events: [received({ lineItemIds: ["li-socks"] })] }),
    now: "2026-10-01T12:00:00.000Z",
    expected: {
      kind: "refund_overdue",
      amountAtStake: 21.6,
      dueAt: "2026-09-30T12:00:00.000Z",
      severity: "low",
      explain: { expectedAmount: 21.6 },
    },
  },
  {
    name: "partial refund missing the prorated tax is short",
    order: makeOrder({ events: [received({ lineItemIds: ["li-socks"] }), refund(20)] }),
    now: "2026-10-15T12:00:00.000Z",
    expected: { kind: "refund_short", amountAtStake: 1.6, dueAt: null },
  },
  {
    name: "email-stated SLA overrides the default",
    order: makeOrder({
      merchant: {
        name: "Northwind Outfitters",
        domain: "northwind.example",
        policy: makePolicy({
          refundSlaDays: 5,
          policySource: "email_text",
          policyQuote: "Refunds are issued within 5 days of receiving your return.",
        }),
      },
      events: [received()],
    }),
    now: "2026-09-26T12:00:00.000Z",
    expected: {
      kind: "refund_overdue",
      amountAtStake: 113,
      dueAt: "2026-09-25T12:00:00.000Z",
      explain: {
        slaDays: 5,
        slaSource: "email_text",
        sourceQuote: "Refunds are issued within 5 days of receiving your return.",
      },
    },
  },
  {
    name: "out-of-order events: strong trigger wins and a refund before T does not match",
    order: makeOrder({
      events: [
        refund(113, "2026-09-18T12:00:00.000Z"),
        received(),
        makeEvent("return_started", "2026-09-12T12:00:00.000Z"),
      ],
    }),
    now: "2026-10-01T12:00:00.000Z",
    expected: {
      kind: "refund_overdue",
      amountAtStake: 113,
      dueAt: "2026-09-30T12:00:00.000Z",
      explain: { triggerType: "strong", triggerAt: RECEIVED_AT },
    },
  },
  {
    name: "out-of-order events with a matching refund",
    order: makeOrder({
      events: [
        refund(113),
        makeEvent("delivered", "2026-09-05T12:00:00.000Z"),
        received(),
        makeEvent("return_started", "2026-09-12T12:00:00.000Z"),
      ],
    }),
    now: "2026-10-15T12:00:00.000Z",
    expected: null,
  },
  {
    name: "refund without a stated amount is matched but not checked for shortfall",
    order: makeOrder({ events: [received(), refund(null)] }),
    now: "2026-10-15T12:00:00.000Z",
    expected: null,
  },
  {
    name: "no return events",
    order: makeOrder({ events: [makeEvent("delivered", "2026-09-05T12:00:00.000Z")] }),
    now: "2026-12-01T12:00:00.000Z",
    expected: null,
  },
];

describe("refundRule (R1)", () => {
  it.each(cases)("$name", ({ order, now, expected }) => {
    const findings = refundRule.evaluate(order, { now: new Date(now) });
    if (expected === null) {
      expect(findings).toEqual([]);
      return;
    }
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding).toMatchObject({
      id: `${expected.kind}:${order.id}`,
      kind: expected.kind,
      orderId: order.id,
      amountAtStake: expected.amountAtStake,
      dueAt: expected.dueAt,
      ruleVersion: "R1@1",
      currency: "USD",
    });
    if (expected.severity) expect(finding.severity).toBe(expected.severity);
    expect(finding.explain).toMatchObject({ rule: expected.kind, ...expected.explain });
  });

  it("every finding from the table passes FindingSchema", () => {
    const findings = cases.flatMap(({ order, now }) =>
      refundRule.evaluate(order, { now: new Date(now) }),
    );
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(FindingSchema.safeParse(finding).success).toBe(true);
    }
  });

  it("skips needsReview orders when run through runRules", () => {
    const order = makeOrder({ events: [received()], needsReview: true, confMin: 0.5 });
    const ctx = { now: new Date("2026-10-01T12:00:00.000Z") };
    expect(refundRule.evaluate(order, ctx)).toHaveLength(1);
    expect(runRules([order], [refundRule], ctx)).toEqual([]);
  });

  it("uses event evidence when present and generated quotes otherwise", () => {
    const order = makeOrder({
      events: [
        received({ messageId: "msg-rcv", evidence: "We received your return on Sep 20." }),
        makeEvent("refund_issued", "2026-09-24T12:00:00.000Z", { amount: 100, messageId: "msg-ref" }),
      ],
    });
    const [finding] = refundRule.evaluate(order, { now: new Date("2026-10-15T12:00:00.000Z") });
    expect(finding.evidence).toEqual([
      { messageId: "msg-rcv", quote: "We received your return on Sep 20." },
      { messageId: "msg-ref", quote: "Refund of 100.00 USD issued on 2026-09-24" },
    ]);
    expect(finding.explain.sourceQuote).toBe("We received your return on Sep 20.");
  });

  it("generates a trigger quote and summary for an overdue finding", () => {
    const order = makeOrder({ events: [received({ messageId: "msg-rcv" })] });
    const [finding] = refundRule.evaluate(order, { now: new Date("2026-10-01T12:00:00.000Z") });
    expect(finding.evidence).toEqual([{ messageId: "msg-rcv", quote: "Return received on 2026-09-20" }]);
    expect(finding.summary).toBe(
      "Return received on 2026-09-20; no refund within 10 days (expected by 2026-09-30).",
    );
  });

  it("explain carries the R1 math and display fields", () => {
    const order = makeOrder({
      events: [received({ conf: 0.8 }), refund(100)],
    });
    const [finding] = refundRule.evaluate(order, { now: new Date("2026-10-15T12:00:00.000Z") });
    const explain = finding.explain as RefundExplain;
    expect(explain).toMatchObject({ rule: "refund_short", summary: finding.summary, confidence: 0.8 });
    expect(explain).toEqual({
      rule: "refund_short",
      summary: "Refund of 100.00 USD is 13.00 USD less than the 113.00 USD expected.",
      triggerType: "strong",
      triggerAt: RECEIVED_AT,
      slaDays: 10,
      slaSource: "default",
      expectedBy: "2026-09-30T12:00:00.000Z",
      expectedAmount: 113,
      refundedAmount: 100,
      tolerance: 2.26,
      dates: [
        { label: "Return received", value: RECEIVED_AT },
        { label: "Refund expected by", value: "2026-09-30T12:00:00.000Z" },
        { label: "Refund issued", value: "2026-09-24T12:00:00.000Z" },
      ],
      confidence: 0.8,
      sourceQuote: "Return received on 2026-09-20",
    });
  });

  it("does not mutate the input order", () => {
    const order = makeOrder({
      events: [refund(113, "2026-09-18T12:00:00.000Z"), received()],
    });
    const snapshot = structuredClone(order);
    refundRule.evaluate(order, { now: new Date("2026-10-01T12:00:00.000Z") });
    expect(order).toEqual(snapshot);
  });
});

describe("expectedRefundAmount", () => {
  it.each([
    { name: "no lineItemIds -> order total", lineItemIds: undefined, items: undefined, expected: 113 },
    { name: "every item returned -> order total", lineItemIds: ["li-jacket", "li-socks"], items: undefined, expected: 113 },
    { name: "unknown ids -> order total", lineItemIds: ["li-other"], items: undefined, expected: 113 },
    { name: "one item, full qty + prorated tax", lineItemIds: ["li-jacket"], items: undefined, expected: 86.4 },
    {
      name: "returnedQty > 0 limits the returned quantity",
      lineItemIds: ["li-socks"],
      items: [
        { id: "li-jacket", name: "Rain Jacket", qty: 1, unitPrice: 80, returnedQty: 0 },
        { id: "li-socks", name: "Wool Socks", qty: 2, unitPrice: 10, returnedQty: 1 },
      ],
      expected: 10.8,
    },
  ])("$name", ({ lineItemIds, items, expected }) => {
    const order = makeOrder(items ? { lineItems: items } : {});
    expect(expectedRefundAmount(order, received({ lineItemIds }))).toBe(expected);
  });

  it("falls back to the line-item subtotal when subtotal is unknown", () => {
    const order = makeOrder({ subtotal: null });
    expect(expectedRefundAmount(order, received({ lineItemIds: ["li-socks"] }))).toBe(21.6);
  });
});
