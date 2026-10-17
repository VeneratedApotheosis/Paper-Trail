import { describe, expect, it } from "vitest";
import { FindingSchema, type NormalizedOrder } from "@/lib/contracts";
import type { PriceFeed, PriceObservation } from "@/lib/prices/feed";
import { runRules, type RuleContext } from "./engine";
import { defaultRules } from "./index";
import { priceDropRule, type PriceDropExplain } from "./pricedrop";
import { makeEvent, makeOrder, makePolicy } from "./test-helpers";

/**
 * Default order (test-helpers): placed 2026-09-01T10:00Z, jacket 1 × 80 (NW-RJ-1), socks 2 × 10 (NW-WS-2).
 * Default 14-day window => claim by 2026-09-15T10:00Z.
 */
const NOW = new Date("2026-09-10T12:00:00.000Z");
const ADJUST_BY = "2026-09-15T10:00:00.000Z";

function observation(overrides: Partial<PriceObservation> = {}): PriceObservation {
  return {
    merchant: "Northwind Outfitters",
    sku: "NW-RJ-1",
    name: "Rain Jacket",
    price: 70,
    currency: "USD",
    observedAt: "2026-09-08T00:00:00.000Z",
    source: "mock",
    ...overrides,
  };
}

const feedOf = (...observations: PriceObservation[]): PriceFeed => ({ simulated: true, observations });

function evaluate(order: NormalizedOrder, priceFeed: PriceFeed | undefined, now = NOW) {
  const ctx: RuleContext = { now, priceFeed };
  return priceDropRule.evaluate(order, ctx);
}

const explainOf = (finding: { explain: Record<string, unknown> }) => finding.explain as PriceDropExplain;

const singleItemOrder = (unitPrice: number, overrides: Partial<NormalizedOrder> = {}) =>
  makeOrder({
    subtotal: unitPrice,
    tax: 0,
    shipping: 0,
    total: unitPrice,
    lineItems: [{ id: "li-tent", name: "Trail Tent", sku: "NW-TT-9", qty: 1, unitPrice, returnedQty: 0 }],
    ...overrides,
  });

describe("priceDropRule (R3)", () => {
  it("fires with the spec summary, due date and amount for the Rain Shell example", () => {
    const order = makeOrder({
      placedAt: "2026-10-10T09:00:00.000Z",
      subtotal: 129,
      tax: 0,
      shipping: 0,
      total: 129,
      lineItems: [{ id: "li-shell", name: "Rain Shell", sku: "NW-RS-3", qty: 1, unitPrice: 129, returnedQty: 0 }],
    });
    const feed = feedOf(observation({ sku: "NW-RS-3", price: 99, observedAt: "2026-10-15T08:00:00.000Z" }));
    const [finding] = evaluate(order, feed, new Date("2026-10-16T12:00:00.000Z"));

    expect(finding).toMatchObject({
      id: "price_drop:ord-1:li-shell",
      kind: "price_drop",
      orderId: "ord-1",
      lineItemId: "li-shell",
      amountAtStake: 30,
      currency: "USD",
      dueAt: "2026-10-24T09:00:00.000Z",
      severity: "medium",
      status: "open",
      ruleVersion: "R3@1",
      summary: "Rain Shell dropped from $129.00 to $99.00; claim $30.00 by 2026-10-24.",
      simulated: true,
    });
    expect(finding.evidence).toEqual([
      { messageId: "msg-order", quote: "Paid 129.00 USD for Rain Shell on 2026-10-10" },
      { messageId: "price-feed", quote: "Simulated price feed: 99.00 USD observed 2026-10-15" },
    ]);
    expect(finding.explain).toEqual({
      rule: "price_drop",
      summary: finding.summary,
      paidUnitPrice: 129,
      currentPrice: 99,
      qty: 1,
      drop: 30,
      threshold: 6.45,
      windowDays: 14,
      windowSource: "default",
      adjustBy: "2026-10-24T09:00:00.000Z",
      priceSource: "mock",
      observedAt: "2026-10-15T08:00:00.000Z",
      dates: [
        { label: "Ordered", value: "2026-10-10T09:00:00.000Z" },
        { label: "Price observed", value: "2026-10-15T08:00:00.000Z" },
        { label: "Claim by", value: "2026-10-24T09:00:00.000Z" },
      ],
      confidence: 0.95,
      sourceQuote: "Paid 129.00 USD for Rain Shell on 2026-10-10",
    } satisfies PriceDropExplain);
    expect(FindingSchema.safeParse(finding).success).toBe(true);
  });

  it("fires when the drop equals the $5 floor", () => {
    const findings = evaluate(makeOrder(), feedOf(observation({ price: 75 })));
    expect(findings).toHaveLength(1);
    expect(findings[0].amountAtStake).toBe(5);
    expect(explainOf(findings[0]).threshold).toBe(5);
  });

  it("does not fire below the $5 floor", () => {
    expect(evaluate(makeOrder(), feedOf(observation({ price: 75.01 })))).toEqual([]);
  });

  it("requires 5% of the paid amount for expensive items", () => {
    const order = singleItemOrder(500);
    const tent = (price: number) => feedOf(observation({ sku: "NW-TT-9", price }));
    expect(evaluate(order, tent(476))).toEqual([]);
    const [finding] = evaluate(order, tent(475));
    expect(finding.amountAtStake).toBe(25);
    expect(explainOf(finding).threshold).toBe(25);
  });

  it("does not fire when the price went up or stayed the same", () => {
    expect(evaluate(makeOrder(), feedOf(observation({ price: 80 })))).toEqual([]);
    expect(evaluate(makeOrder(), feedOf(observation({ price: 90 })))).toEqual([]);
  });

  it("fires at the end of the window but not after it", () => {
    const feed = feedOf(observation());
    expect(evaluate(makeOrder(), feed, new Date(ADJUST_BY))).toHaveLength(1);
    expect(evaluate(makeOrder(), feed, new Date("2026-09-15T10:00:00.001Z"))).toEqual([]);
  });

  it("uses the email-stated price adjustment window", () => {
    const order = makeOrder({
      merchant: {
        name: "Northwind Outfitters",
        domain: "northwind.example",
        policy: makePolicy({
          priceAdjustDays: 30,
          policySource: "email_text",
          policyQuote: "We'll refund the difference if the price drops within 30 days.",
        }),
      },
    });
    const [finding] = evaluate(order, feedOf(observation()), new Date("2026-09-25T12:00:00.000Z"));
    expect(finding.dueAt).toBe("2026-10-01T10:00:00.000Z");
    expect(explainOf(finding)).toMatchObject({
      windowDays: 30,
      windowSource: "email_text",
      sourceQuote: "We'll refund the difference if the price drops within 30 days.",
    });
    expect(finding.evidence[0]).toEqual({
      messageId: "msg-order",
      quote: "We'll refund the difference if the price drops within 30 days.",
    });
  });

  it("uses the latest observation at or before now and ignores future ones", () => {
    const feed = feedOf(
      observation({ price: 60, observedAt: "2026-09-03T00:00:00.000Z" }),
      observation({ price: 72, observedAt: "2026-09-09T00:00:00.000Z" }),
      observation({ price: 40, observedAt: "2026-09-11T00:00:00.000Z" }),
    );
    const [finding] = evaluate(makeOrder(), feed);
    expect(finding.amountAtStake).toBe(8);
    expect(explainOf(finding)).toMatchObject({ currentPrice: 72, observedAt: "2026-09-09T00:00:00.000Z" });
  });

  it("matches the merchant name case-insensitively", () => {
    expect(evaluate(makeOrder(), feedOf(observation({ merchant: "northwind OUTFITTERS" })))).toHaveLength(1);
  });

  it("does not fire on a currency mismatch", () => {
    expect(evaluate(makeOrder(), feedOf(observation({ currency: "EUR" })))).toEqual([]);
  });

  it("skips fully returned line items", () => {
    const order = makeOrder({
      lineItems: [
        { id: "li-jacket", name: "Rain Jacket", sku: "NW-RJ-1", qty: 1, unitPrice: 80, returnedQty: 1 },
      ],
    });
    expect(evaluate(order, feedOf(observation({ price: 10 })))).toEqual([]);
  });

  it("multiplies the drop by quantity and excludes returned units", () => {
    const socksFeed = feedOf(observation({ sku: "NW-WS-2", name: "Wool Socks", price: 7 }));
    const [finding] = evaluate(makeOrder(), socksFeed);
    expect(finding).toMatchObject({ id: "price_drop:ord-1:li-socks", lineItemId: "li-socks", amountAtStake: 6 });
    expect(explainOf(finding)).toMatchObject({ qty: 2, drop: 6, threshold: 5 });

    const oneReturned = makeOrder({
      lineItems: [
        { id: "li-socks", name: "Wool Socks", sku: "NW-WS-2", qty: 2, unitPrice: 10, returnedQty: 1 },
      ],
    });
    expect(evaluate(oneReturned, socksFeed)).toEqual([]);
  });

  it("skips cancelled orders, final-sale policies and items without a sku", () => {
    const feed = feedOf(observation());
    expect(evaluate(makeOrder({ events: [makeEvent("cancel", "2026-09-02T10:00:00.000Z")] }), feed)).toEqual([]);
    const finalSale = makeOrder({
      merchant: { name: "Northwind Outfitters", domain: null, policy: makePolicy({ nonReturnable: true }) },
    });
    expect(evaluate(finalSale, feed)).toEqual([]);
    const noSku = makeOrder({
      lineItems: [{ id: "li-jacket", name: "Rain Jacket", sku: null, qty: 1, unitPrice: 80, returnedQty: 0 }],
    });
    expect(evaluate(noSku, feed)).toEqual([]);
  });

  it("does not fire without a price feed or a matching observation", () => {
    expect(evaluate(makeOrder(), undefined)).toEqual([]);
    expect(evaluate(makeOrder(), feedOf())).toEqual([]);
  });

  it("marks mock observations simulated and email_promo observations not", () => {
    const [mock] = evaluate(makeOrder(), feedOf(observation({ source: "mock" })));
    expect(mock.simulated).toBe(true);
    expect(explainOf(mock).priceSource).toBe("mock");
    expect(mock.evidence.map((evidence) => evidence.messageId)).toEqual(["msg-order", "price-feed"]);

    const [promo] = evaluate(makeOrder(), feedOf(observation({ source: "email_promo" })));
    expect(promo.simulated).toBe(false);
    expect(explainOf(promo).priceSource).toBe("email_promo");
    expect(promo.evidence.map((evidence) => evidence.messageId)).toEqual(["msg-order"]);
  });

  it("emits one deterministic finding per dropped line item", () => {
    const feed = feedOf(observation(), observation({ sku: "NW-WS-2", name: "Wool Socks", price: 7 }));
    const ids = evaluate(makeOrder(), feed).map((finding) => finding.id);
    expect(ids).toEqual(["price_drop:ord-1:li-jacket", "price_drop:ord-1:li-socks"]);
    expect(evaluate(makeOrder(), feed).map((finding) => finding.id)).toEqual(ids);
  });

  it("produces findings that pass FindingSchema", () => {
    const feed = feedOf(observation(), observation({ sku: "NW-WS-2", source: "email_promo", price: 7 }));
    for (const finding of evaluate(makeOrder(), feed)) {
      expect(FindingSchema.safeParse(finding).success).toBe(true);
    }
  });

  it("clips generated evidence quotes to the 200-char limit", () => {
    const longName = "Ultralight ".repeat(30).trim();
    const order = makeOrder({
      lineItems: [{ id: "li-long", name: longName, sku: "NW-RJ-1", qty: 1, unitPrice: 80, returnedQty: 0 }],
    });
    const [finding] = evaluate(order, feedOf(observation()));
    expect(finding.evidence[0].quote.length).toBe(200);
    expect(FindingSchema.safeParse(finding).success).toBe(true);
  });
});

describe("defaultRules with R3", () => {
  it("runRules returns R3 findings alongside R1 when a price feed is provided", () => {
    const priceDropOrder = makeOrder();
    const refundOrder = makeOrder({
      id: "ord-2",
      placedAt: "2026-08-01T10:00:00.000Z",
      events: [makeEvent("return_received", "2026-08-20T12:00:00.000Z")],
    });
    const findings = runRules([priceDropOrder, refundOrder], defaultRules, {
      now: NOW,
      priceFeed: feedOf(observation()),
    });
    expect(findings.map((finding) => [finding.id, finding.ruleVersion])).toEqual([
      ["refund_overdue:ord-2", "R1@1"],
      ["price_drop:ord-1:li-jacket", "R3@1"],
    ]);
  });

  it("runRules emits no R3 findings without a price feed", () => {
    expect(runRules([makeOrder()], defaultRules, { now: NOW })).toEqual([]);
  });
});
