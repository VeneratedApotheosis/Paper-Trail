import { describe, expect, it } from "vitest";
import { FindingSchema, type Finding, type MerchantPolicy, type NormalizedOrder } from "@/lib/contracts";
import { runRules } from "./engine";
import { defaultRules } from "./index";
import { returnRule, type ReturnExplain } from "./return";
import { makeEvent, makeOrder, makePolicy } from "./test-helpers";

// Default order: placed 2026-09-01T10:00Z, total 113 USD, policy 30 days from delivery.
const PLACED_AT = "2026-09-01T10:00:00.000Z";
const DELIVERED_AT = "2026-09-05T12:00:00.000Z";
const DELIVERY_DEADLINE = "2026-10-05T12:00:00.000Z";
const ORDER_DEADLINE = "2026-10-01T10:00:00.000Z";
const POLICY_QUOTE = "You can return items within 45 days of delivery.";

const delivered = (overrides: Parameters<typeof makeEvent>[2] = {}) =>
  makeEvent("delivered", DELIVERED_AT, overrides);

const withPolicy = (overrides: Partial<MerchantPolicy>): Pick<NormalizedOrder, "merchant"> => ({
  merchant: { name: "Northwind Outfitters", domain: "northwind.example", policy: makePolicy(overrides) },
});

interface ReturnCase {
  name: string;
  order: NormalizedOrder;
  now: string;
  expected: null | {
    dueAt: string;
    summary: string;
    severity?: Finding["severity"];
    amountAtStake?: number;
    explain?: Partial<ReturnExplain>;
  };
}

const cases: ReturnCase[] = [
  {
    name: "delivery anchor: window counts from the delivered event",
    order: makeOrder({ events: [delivered()] }),
    now: "2026-10-02T12:00:00.000Z",
    expected: {
      dueAt: DELIVERY_DEADLINE,
      summary: "Return window closes 2026-10-05 (3 days left).",
      severity: "high",
      amountAtStake: 113,
      explain: { anchorType: "delivery", anchorAt: DELIVERED_AT, windowDays: 30, daysLeft: 3 },
    },
  },
  {
    name: "order anchor: window counts from placedAt even when delivered",
    order: makeOrder({ ...withPolicy({ windowAnchor: "order" }), events: [delivered()] }),
    now: "2026-09-28T10:00:00.000Z",
    expected: {
      dueAt: ORDER_DEADLINE,
      summary: "Return window closes 2026-10-01 (3 days left).",
      explain: { anchorType: "order", anchorAt: PLACED_AT, daysLeft: 3 },
    },
  },
  {
    name: "delivery anchor without a delivered event falls back to placedAt",
    order: makeOrder({ events: [makeEvent("shipped", "2026-09-02T10:00:00.000Z")] }),
    now: "2026-09-28T10:00:00.000Z",
    expected: {
      dueAt: ORDER_DEADLINE,
      summary: "Return window closes 2026-10-01 (3 days left).",
      explain: { anchorType: "order", anchorAt: PLACED_AT },
    },
  },
  {
    name: "earliest delivered event is the anchor",
    order: makeOrder({
      events: [makeEvent("delivered", "2026-09-07T12:00:00.000Z"), delivered()],
    }),
    now: "2026-10-02T12:00:00.000Z",
    expected: {
      dueAt: DELIVERY_DEADLINE,
      summary: "Return window closes 2026-10-05 (3 days left).",
      explain: { anchorAt: DELIVERED_AT },
    },
  },
  {
    name: "email-stated window overrides the default",
    order: makeOrder({
      ...withPolicy({ returnWindowDays: 45, policySource: "email_text", policyQuote: POLICY_QUOTE }),
      events: [delivered()],
    }),
    now: "2026-10-17T12:00:00.000Z",
    expected: {
      dueAt: "2026-10-20T12:00:00.000Z",
      summary: "Return window closes 2026-10-20 (3 days left).",
      explain: { windowDays: 45, windowSource: "email_text", sourceQuote: POLICY_QUOTE },
    },
  },
  {
    name: "unknown window uses the default 30 days from the order date",
    order: makeOrder({
      ...withPolicy({ returnWindowDays: null, windowAnchor: null }),
      events: [delivered()],
    }),
    now: "2026-09-28T10:00:00.000Z",
    expected: {
      dueAt: ORDER_DEADLINE,
      summary: "Return window closes 2026-10-01 (3 days left).",
      explain: { windowDays: 30, windowSource: "default", anchorType: "order" },
    },
  },
  {
    name: "exactly 7 days left fires",
    order: makeOrder({ events: [delivered()] }),
    now: "2026-09-28T12:00:00.000Z",
    expected: {
      dueAt: DELIVERY_DEADLINE,
      summary: "Return window closes 2026-10-05 (7 days left).",
      explain: { daysLeft: 7 },
    },
  },
  {
    name: "7 days and 1 minute left does not fire",
    order: makeOrder({ events: [delivered()] }),
    now: "2026-09-28T11:59:00.000Z",
    expected: null,
  },
  {
    name: "partial days round up",
    order: makeOrder({ events: [delivered()] }),
    now: "2026-10-04T00:00:00.000Z",
    expected: {
      dueAt: DELIVERY_DEADLINE,
      summary: "Return window closes 2026-10-05 (2 days left).",
      explain: { daysLeft: 2 },
    },
  },
  {
    name: "1 minute left reads as 1 day",
    order: makeOrder({ events: [delivered()] }),
    now: "2026-10-05T11:59:00.000Z",
    expected: {
      dueAt: DELIVERY_DEADLINE,
      summary: "Return window closes 2026-10-05 (1 day left).",
      explain: { daysLeft: 1 },
    },
  },
  {
    name: "deadline exactly now fires with 0 days left",
    order: makeOrder({ events: [delivered()] }),
    now: DELIVERY_DEADLINE,
    expected: {
      dueAt: DELIVERY_DEADLINE,
      summary: "Return window closes 2026-10-05 (0 days left).",
      explain: { daysLeft: 0 },
    },
  },
  {
    name: "expired window does not fire",
    order: makeOrder({ events: [delivered()] }),
    now: "2026-10-05T12:01:00.000Z",
    expected: null,
  },
  {
    name: "far from the deadline does not fire",
    order: makeOrder({ events: [delivered()] }),
    now: "2026-09-10T12:00:00.000Z",
    expected: null,
  },
  {
    name: "return already started suppresses the alert",
    order: makeOrder({ events: [delivered(), makeEvent("return_started", "2026-09-20T12:00:00.000Z")] }),
    now: "2026-10-02T12:00:00.000Z",
    expected: null,
  },
  {
    name: "return dropped off suppresses the alert",
    order: makeOrder({ events: [delivered(), makeEvent("return_dropped", "2026-09-20T12:00:00.000Z")] }),
    now: "2026-10-02T12:00:00.000Z",
    expected: null,
  },
  {
    name: "return received suppresses the alert",
    order: makeOrder({ events: [delivered(), makeEvent("return_received", "2026-09-20T12:00:00.000Z")] }),
    now: "2026-10-02T12:00:00.000Z",
    expected: null,
  },
  {
    name: "cancelled order suppresses the alert",
    order: makeOrder({ events: [makeEvent("cancel", "2026-09-02T10:00:00.000Z")] }),
    now: "2026-09-28T10:00:00.000Z",
    expected: null,
  },
  {
    name: "non-returnable order suppresses the alert",
    order: makeOrder({ ...withPolicy({ nonReturnable: true }), events: [delivered()] }),
    now: "2026-10-02T12:00:00.000Z",
    expected: null,
  },
  {
    name: "severity follows the order total",
    order: makeOrder({ total: 19.999, events: [delivered()] }),
    now: "2026-10-02T12:00:00.000Z",
    expected: {
      dueAt: DELIVERY_DEADLINE,
      summary: "Return window closes 2026-10-05 (3 days left).",
      severity: "low",
      amountAtStake: 20,
    },
  },
];

describe("returnRule (R2)", () => {
  it.each(cases)("$name", ({ order, now, expected }) => {
    const findings = returnRule.evaluate(order, { now: new Date(now) });
    if (expected === null) {
      expect(findings).toEqual([]);
      return;
    }
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding).toMatchObject({
      id: `return_deadline:${order.id}`,
      kind: "return_deadline",
      orderId: order.id,
      dueAt: expected.dueAt,
      summary: expected.summary,
      ruleVersion: "R2@1",
      currency: "USD",
      status: "open",
      simulated: false,
    });
    if (expected.severity) expect(finding.severity).toBe(expected.severity);
    if (expected.amountAtStake !== undefined) expect(finding.amountAtStake).toBe(expected.amountAtStake);
    expect(finding.explain).toMatchObject({
      rule: "return_deadline",
      summary: expected.summary,
      deadline: expected.dueAt,
      ...expected.explain,
    });
  });

  it("every finding from the table passes FindingSchema", () => {
    const findings = cases.flatMap(({ order, now }) =>
      returnRule.evaluate(order, { now: new Date(now) }),
    );
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(FindingSchema.parse(finding)).toEqual(finding);
    }
  });

  it("explain carries the R2 math and display fields", () => {
    const order = makeOrder({ events: [delivered({ messageId: "msg-dlv" })] });
    const [finding] = returnRule.evaluate(order, { now: new Date("2026-10-02T12:00:00.000Z") });
    expect(finding.evidence).toEqual([{ messageId: "msg-dlv", quote: "Delivered on 2026-09-05" }]);
    expect(finding.explain).toEqual({
      rule: "return_deadline",
      summary: "Return window closes 2026-10-05 (3 days left).",
      anchorType: "delivery",
      anchorAt: DELIVERED_AT,
      windowDays: 30,
      windowSource: "email_text",
      deadline: DELIVERY_DEADLINE,
      daysLeft: 3,
      dates: [
        { label: "Delivered", value: DELIVERED_AT },
        { label: "Return by", value: DELIVERY_DEADLINE },
      ],
      confidence: 0.95,
      sourceQuote: "Delivered on 2026-09-05",
    });
  });

  it("generates an order-date quote citing the order email for the order anchor", () => {
    const order = makeOrder({ ...withPolicy({ windowAnchor: "order" }), events: [delivered()] });
    const [finding] = returnRule.evaluate(order, { now: new Date("2026-09-28T10:00:00.000Z") });
    expect(finding.evidence).toEqual([{ messageId: "msg-order", quote: "Ordered on 2026-09-01" }]);
    expect(finding.explain).toMatchObject({
      dates: [
        { label: "Ordered", value: PLACED_AT },
        { label: "Return by", value: ORDER_DEADLINE },
      ],
      sourceQuote: "Ordered on 2026-09-01",
    });
  });

  it("cites the policy quote from the order email when present", () => {
    const order = makeOrder({
      ...withPolicy({ returnWindowDays: 45, policySource: "email_text", policyQuote: POLICY_QUOTE }),
      events: [delivered({ messageId: "msg-dlv" })],
    });
    const [finding] = returnRule.evaluate(order, { now: new Date("2026-10-17T12:00:00.000Z") });
    expect(finding.evidence).toEqual([{ messageId: "msg-order", quote: POLICY_QUOTE }]);
  });

  it.each([
    { name: "low delivered-event confidence", order: makeOrder({ events: [delivered({ conf: 0.6 })] }), confidence: 0.6 },
    { name: "low order confidence", order: makeOrder({ confMin: 0.5, events: [delivered()] }), confidence: 0.5 },
  ])("flags checkPolicy on $name", ({ order, confidence }) => {
    const [finding] = returnRule.evaluate(order, { now: new Date("2026-10-02T12:00:00.000Z") });
    expect(finding.explain).toMatchObject({ confidence, checkPolicy: true });
  });

  it("ignores delivered-event confidence for the order anchor and omits checkPolicy at >= 0.7", () => {
    const order = makeOrder({
      ...withPolicy({ windowAnchor: "order" }),
      confMin: 0.7,
      events: [delivered({ conf: 0.3 })],
    });
    const [finding] = returnRule.evaluate(order, { now: new Date("2026-09-28T10:00:00.000Z") });
    expect(finding.explain.confidence).toBe(0.7);
    expect(finding.explain).not.toHaveProperty("checkPolicy");
  });

  it("does not mutate the input order", () => {
    const order = makeOrder({ events: [makeEvent("delivered", "2026-09-07T12:00:00.000Z"), delivered()] });
    const snapshot = structuredClone(order);
    returnRule.evaluate(order, { now: new Date("2026-10-02T12:00:00.000Z") });
    expect(order).toEqual(snapshot);
  });
});

describe("defaultRules with R2", () => {
  it("returns R1 and R2 findings sorted by dueAt, all passing FindingSchema", () => {
    const now = { now: new Date("2026-10-02T12:00:00.000Z") };
    const orders = [
      makeOrder({ id: "late-window", events: [makeEvent("delivered", "2026-09-07T12:00:00.000Z")] }),
      makeOrder({ id: "window", events: [delivered()] }),
      makeOrder({
        id: "overdue",
        events: [delivered(), makeEvent("return_received", "2026-09-20T12:00:00.000Z")],
      }),
      makeOrder({ id: "quiet", events: [makeEvent("delivered", "2026-09-25T12:00:00.000Z")] }),
    ];
    const findings = runRules(orders, defaultRules, now);
    expect(findings.map((finding) => [finding.id, finding.ruleVersion, finding.dueAt])).toEqual([
      ["refund_overdue:overdue", "R1@1", "2026-09-30T12:00:00.000Z"],
      ["return_deadline:window", "R2@1", DELIVERY_DEADLINE],
      ["return_deadline:late-window", "R2@1", "2026-10-07T12:00:00.000Z"],
    ]);
    for (const finding of findings) expect(FindingSchema.parse(finding)).toEqual(finding);
  });
});
