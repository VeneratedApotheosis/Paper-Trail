import type { Finding, NormalizedOrder } from "@/lib/contracts";
import type { PriceFeed } from "@/lib/prices/feed";
import { priceDropRule } from "@/lib/rules/pricedrop";
import { refundRule } from "@/lib/rules/refund";
import { returnRule } from "@/lib/rules/return";
import { makeEvent, makeOrder, makePolicy } from "@/lib/rules/test-helpers";

/**
 * Synthetic claim fixtures: real findings produced by the rules from small orders (rules/test-helpers default order:
 * NW-1001 placed 2026-09-01, jacket 1 × $80 + socks 2 × $10, tax $8, shipping $5, total $113).
 */

export const POLICY_QUOTE = "Refunds are issued within 10 days of receiving your return.";

function only(findings: Finding[]): Finding {
  if (findings.length !== 1) throw new Error(`expected exactly one finding, got ${findings.length}`);
  return findings[0];
}

export type ClaimFixture = { order: NormalizedOrder; finding: Finding; now: Date };

/** Return received Sep 20, SLA 10 days (policy quote) => $113.00 expected by Sep 30; now Oct 5. */
export function refundOverdueFixture(): ClaimFixture {
  const order = makeOrder({
    merchant: {
      name: "Northwind Outfitters",
      domain: "northwind.example",
      policy: makePolicy({ refundSlaDays: 10, policySource: "email_text", policyQuote: POLICY_QUOTE }),
    },
    events: [
      makeEvent("delivered", "2026-09-05T15:00:00.000Z"),
      makeEvent("return_received", "2026-09-20T12:00:00.000Z"),
    ],
  });
  const now = new Date("2026-10-05T12:00:00.000Z");
  return { order, finding: only(refundRule.evaluate(order, { now })), now };
}

/** Jacket returned: expected $80 + $6.40 prorated tax = $86.40; refunded $60.00 => $26.40 short. */
export function refundShortFixture(): ClaimFixture {
  const order = makeOrder({
    lineItems: [
      { id: "li-jacket", name: "Rain Jacket", sku: "NW-RJ-1", qty: 1, unitPrice: 80, returnedQty: 1 },
      { id: "li-socks", name: "Wool Socks", sku: "NW-WS-2", qty: 2, unitPrice: 10, returnedQty: 0 },
    ],
    events: [
      makeEvent("delivered", "2026-09-05T15:00:00.000Z"),
      makeEvent("return_received", "2026-09-20T12:00:00.000Z", { lineItemIds: ["li-jacket"] }),
      makeEvent("refund_issued", "2026-09-24T12:00:00.000Z", { amount: 60 }),
    ],
  });
  const now = new Date("2026-09-25T12:00:00.000Z");
  return { order, finding: only(refundRule.evaluate(order, { now })), now };
}

/** Delivered Sep 5, 30-day window from delivery => return by Oct 5; now Sep 30. */
export function returnDeadlineFixture(): ClaimFixture {
  const order = makeOrder({ events: [makeEvent("delivered", "2026-09-05T15:00:00.000Z")] });
  const now = new Date("2026-09-30T12:00:00.000Z");
  return { order, finding: only(returnRule.evaluate(order, { now })), now };
}

export const SIMULATED_FEED: PriceFeed = {
  simulated: true,
  observations: [
    {
      merchant: "Northwind Outfitters",
      sku: "NW-RJ-1",
      name: "Rain Jacket",
      price: 65,
      currency: "USD",
      observedAt: "2026-09-08T00:00:00.000Z",
      source: "mock",
    },
  ],
};

/** Jacket paid $80, simulated feed $65 on Sep 8 => $15.00 drop, default 14-day window => claim by Sep 15. */
export function priceDropFixture(feed: PriceFeed = SIMULATED_FEED): ClaimFixture {
  const order = makeOrder({
    merchant: {
      name: "Northwind Outfitters",
      domain: "northwind.example",
      policy: makePolicy({ policyQuote: "We match our own lower prices within 14 days of purchase." }),
    },
  });
  const now = new Date("2026-09-10T12:00:00.000Z");
  return { order, finding: only(priceDropRule.evaluate(order, { now, priceFeed: feed })), now };
}

/** rewards_gap has no rule yet (R4); a hand-built synthetic finding stands in. */
export function rewardsGapFixture(): ClaimFixture {
  const order = makeOrder();
  const finding: Finding = {
    id: "rewards_gap:ord-1",
    kind: "rewards_gap",
    orderId: order.id,
    amountAtStake: 2.26,
    currency: "USD",
    dueAt: null,
    severity: "low",
    status: "open",
    ruleVersion: "R4@1",
    summary: "A different card would have earned $2.26 more.",
    evidence: [{ messageId: "msg-order", quote: "Paid with card ending 4242" }],
    explain: {},
    simulated: false,
  };
  return { order, finding, now: new Date("2026-09-10T12:00:00.000Z") };
}
