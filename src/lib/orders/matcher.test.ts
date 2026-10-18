import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NormalizedOrderSchema,
  type EmailClass,
  type ExtractedFields,
  type Extraction,
  type RawEmail,
} from "@/lib/contracts";
import { matchOrders, matchOrdersWithReasons, type MatchInput } from "./matcher";

// Synthetic fixtures only: fictional merchant "Northwind Outfitters" on a reserved .example domain.

const JACKET = { name: "Rain Jacket", sku: "NW-RJ-1", qty: 1, unitPrice: 80 };
const SOCKS = { name: "Wool Socks", sku: "NW-WS-2", qty: 2, unitPrice: 10 };
const ORDER_TOTALS = { subtotal: 100, tax: 8, shipping: 5, total: 113 };

interface InputSpec {
  id: string;
  cls: EmailClass;
  date: string;
  fields?: Partial<ExtractedFields>;
  confMin?: number;
  subject?: string;
  text?: string;
  evidence?: Extraction["evidence"];
}

function input({ id, cls, date, fields = {}, confMin = 0.95, subject = "Order update", text = "", evidence = {} }: InputSpec): MatchInput {
  const email: RawEmail = { id, from: '"Northwind Outfitters" <orders@northwind.example>', subject, date, text };
  const extraction: Extraction = {
    emailId: id,
    class: cls,
    fields: {
      merchant: "Northwind Outfitters",
      merchantDomain: "northwind.example",
      orderRef: "NW-1001",
      date: date.slice(0, 10),
      currency: "USD",
      lineItems: [],
      totals: {},
      ...fields,
    },
    confidence: {},
    evidence,
    confMin,
    model: "test",
    cached: false,
  };
  return { email, extraction };
}

function orderEmail(overrides: Partial<InputSpec> = {}): MatchInput {
  return input({
    id: "nw-1001-order",
    cls: "order",
    date: "2026-09-01T10:00:00Z",
    fields: { lineItems: [JACKET, SOCKS], totals: ORDER_TOTALS, last4: "4242", customerName: "Sam Synthetic" },
    ...overrides,
  });
}

function only<T>(list: T[]): T {
  expect(list).toHaveLength(1);
  return list[0];
}

describe("matchOrders", () => {
  it("groups a multi-email order into one validated order with sorted events", () => {
    const order = only(
      matchOrders([
        orderEmail(),
        input({ id: "nw-1001-shipped", cls: "shipped", date: "2026-09-02T12:00:00Z" }),
        input({ id: "nw-1001-delivered", cls: "delivered", date: "2026-09-05T12:00:00Z" }),
      ]),
    );
    expect(NormalizedOrderSchema.parse(order)).toEqual(order);
    expect(order.id).toBe("order:northwind-outfitters:nw-1001");
    expect(order.orderRef).toBe("NW-1001");
    expect(order.placedAt).toBe("2026-09-01T10:00:00.000Z");
    expect(order.total).toBe(113);
    expect(order.last4).toBe("4242");
    expect(order.events.map((event) => event.type)).toEqual(["shipped", "delivered"]);
    expect(order.messageIds).toEqual(["nw-1001-order", "nw-1001-shipped", "nw-1001-delivered"]);
    expect(order.needsReview).toBe(false);
  });

  it("matches merchant and order ref case-insensitively", () => {
    const orders = matchOrders([
      orderEmail(),
      input({
        id: "nw-1001-shipped",
        cls: "shipped",
        date: "2026-09-02T12:00:00Z",
        fields: { merchant: "NORTHWIND OUTFITTERS", orderRef: "#nw-1001" },
      }),
    ]);
    expect(only(orders).events).toHaveLength(1);
  });

  it("merges a duplicate confirmation without double-counting line items", () => {
    const order = only(matchOrders([orderEmail(), orderEmail({ id: "nw-1001-order-resent", date: "2026-09-01T10:20:00Z" })]));
    expect(order.lineItems).toHaveLength(2);
    expect(order.total).toBe(113);
    expect(order.placedAt).toBe("2026-09-01T10:00:00.000Z");
    expect(order.messageIds).toHaveLength(2);
  });

  it("lets the latest updated confirmation win for totals and line items", () => {
    const updated = orderEmail({
      id: "nw-1001-order-updated",
      date: "2026-09-02T09:00:00Z",
      fields: {
        date: "2026-09-01",
        lineItems: [JACKET],
        totals: { subtotal: 80, tax: 6.4, shipping: 5, total: 91.4 },
      },
    });
    // Updated confirmation passed first: input order must not matter.
    const order = only(matchOrders([updated, orderEmail()]));
    expect(order.lineItems.map((item) => item.name)).toEqual(["Rain Jacket"]);
    expect(order.total).toBe(91.4);
    expect(order.placedAt).toBe("2026-09-01T10:00:00.000Z");
    expect(order.messageIds[0]).toBe("nw-1001-order-updated");
  });

  it("keeps split shipments as separate shipped/delivered events with their line items", () => {
    const order = only(
      matchOrders([
        orderEmail(),
        input({ id: "ship-1", cls: "shipped", date: "2026-09-02T12:00:00Z", fields: { lineItems: [JACKET] } }),
        input({ id: "ship-2", cls: "shipped", date: "2026-09-04T12:00:00Z", fields: { lineItems: [SOCKS] } }),
        input({ id: "deliv-1", cls: "delivered", date: "2026-09-03T12:00:00Z", fields: { lineItems: [JACKET] } }),
        input({ id: "deliv-2", cls: "delivered", date: "2026-09-07T12:00:00Z", fields: { lineItems: [SOCKS] } }),
      ]),
    );
    expect(order.events.map((event) => `${event.type}:${event.messageId}`)).toEqual([
      "shipped:ship-1",
      "delivered:deliv-1",
      "shipped:ship-2",
      "delivered:deliv-2",
    ]);
    expect(order.events[0].lineItemIds).toEqual([order.lineItems[0].id]);
  });

  it("drops a repeated copy of the same lifecycle email", () => {
    const order = only(
      matchOrders([
        orderEmail(),
        input({ id: "refund-a", cls: "refund", date: "2026-09-20T12:00:00Z", fields: { eventAmount: 113 } }),
        input({ id: "refund-b", cls: "refund", date: "2026-09-20T12:30:00Z", fields: { eventAmount: 113 } }),
      ]),
    );
    expect(order.events).toHaveLength(1);
  });

  it("sorts events by event time when emails arrive out of order", () => {
    const order = only(
      matchOrders([
        input({ id: "refund", cls: "refund", date: "2026-09-25T12:00:00Z", fields: { eventAmount: 113 } }),
        input({ id: "received", cls: "return_received", date: "2026-09-20T12:00:00Z" }),
        orderEmail(),
        input({ id: "delivered", cls: "delivered", date: "2026-09-05T12:00:00Z" }),
      ]),
    );
    expect(order.events.map((event) => event.type)).toEqual(["delivered", "return_received", "refund_issued"]);
    expect(order.events[2].amount).toBe(113);
    expect(order.placedAt).toBe("2026-09-01T10:00:00.000Z");
  });

  it("uses the body date over the send time when they fall on different days", () => {
    const order = only(
      matchOrders([
        orderEmail(),
        input({ id: "delivered-late-email", cls: "delivered", date: "2026-09-08T12:00:00Z", fields: { date: "2026-09-05" } }),
      ]),
    );
    expect(order.events[0].at).toBe("2026-09-05T00:00:00.000Z");
  });

  it("falls back to merchant + total + date proximity when the order ref is missing", () => {
    const orders = matchOrders([
      orderEmail(),
      orderEmail({
        id: "nw-copy-no-ref",
        date: "2026-09-02T10:00:00Z",
        fields: { orderRef: null, date: "2026-09-02", lineItems: [JACKET, SOCKS], totals: { total: 113.4 } },
      }),
    ]);
    const order = only(orders);
    expect(order.id).toBe("order:northwind-outfitters:nw-1001");
    expect(order.orderRef).toBe("NW-1001");
    expect([...order.messageIds].sort()).toEqual(["nw-1001-order", "nw-copy-no-ref"]);
  });

  it("does not fall back when the total or date is too far off", () => {
    const orders = matchOrders([
      orderEmail(),
      orderEmail({
        id: "far-date",
        date: "2026-09-10T10:00:00Z",
        fields: { orderRef: null, date: "2026-09-10", lineItems: [JACKET, SOCKS], totals: { total: 113 } },
      }),
      orderEmail({
        id: "other-total",
        date: "2026-09-01T12:00:00Z",
        fields: { orderRef: null, lineItems: [JACKET], totals: { total: 90 } },
      }),
    ]);
    expect(orders).toHaveLength(3);
    const refless = orders.filter((order) => order.orderRef === null);
    expect(refless.map((order) => order.id).sort()).toEqual([
      "order:northwind-outfitters:far-date",
      "order:northwind-outfitters:other-total",
    ]);
  });

  it("never builds orders from marketing or phishing emails", () => {
    const orders = matchOrders([
      input({ id: "promo", cls: "marketing", date: "2026-09-03T12:00:00Z", fields: { totals: { total: 113 } } }),
      input({ id: "phish", cls: "not_receipt", date: "2026-09-03T13:00:00Z", fields: { merchant: "N0rthwind Support" } }),
    ]);
    expect(orders).toEqual([]);
    expect(only(matchOrders([orderEmail(), input({ id: "promo", cls: "marketing", date: "2026-09-02T12:00:00Z" })])).messageIds).toEqual([
      "nw-1001-order",
    ]);
  });

  it("sets lineItemIds and returnedQty for a partial return without double-counting return stages", () => {
    const order = only(
      matchOrders([
        orderEmail(),
        input({
          id: "return-started",
          cls: "return_started",
          date: "2026-09-10T12:00:00Z",
          fields: { lineItems: [{ name: "Wool Socks", sku: "nw-ws-2", qty: 1, unitPrice: 10 }] },
        }),
        input({
          id: "return-received",
          cls: "return_received",
          date: "2026-09-14T12:00:00Z",
          fields: { lineItems: [{ name: "Wool Socks", sku: null, qty: 1, unitPrice: 10 }] },
        }),
      ]),
    );
    const socks = order.lineItems.find((item) => item.sku === "NW-WS-2");
    expect(socks?.returnedQty).toBe(1);
    expect(order.lineItems.find((item) => item.sku === "NW-RJ-1")?.returnedQty).toBe(0);
    expect(order.events.map((event) => event.lineItemIds)).toEqual([[socks?.id], [socks?.id]]);
  });

  it("maps a drop-off email to return_dropped and store credit refunds to store_credit", () => {
    const order = only(
      matchOrders([
        orderEmail(),
        input({
          id: "dropped",
          cls: "return_started",
          date: "2026-09-10T12:00:00Z",
          subject: "Return dropped off: order NW-1001",
          text: "Your return was dropped off at a carrier location.",
        }),
        input({
          id: "credit",
          cls: "refund",
          date: "2026-09-15T12:00:00Z",
          fields: { eventAmount: 113, isStoreCredit: true },
        }),
      ]),
    );
    expect(order.events.map((event) => [event.type, event.amount ?? null])).toEqual([
      ["return_dropped", null],
      ["store_credit", 113],
    ]);
  });

  it("builds the policy from email text with a delivery anchor", () => {
    const quote = "Returns accepted within 30 days of delivery. Refunds are issued within 7 days of receiving your return.";
    const order = only(
      matchOrders([
        orderEmail({
          fields: {
            lineItems: [JACKET],
            totals: { total: 80 },
            returnWindowDays: 30,
            refundSlaDays: 7,
            policyQuote: quote,
          },
        }),
      ]),
    );
    expect(order.merchant.policy).toEqual({
      returnWindowDays: 30,
      windowAnchor: "delivery",
      refundSlaDays: 7,
      priceAdjustDays: null,
      policySource: "email_text",
      policyQuote: quote,
      nonReturnable: false,
    });
  });

  it("anchors a purchase-based window on the order and leaves unknown policy null", () => {
    const stated = only(
      matchOrders([orderEmail({ fields: { returnWindowDays: 90, policyQuote: "Returns accepted within 90 days of purchase." } })]),
    );
    expect(stated.merchant.policy.windowAnchor).toBe("order");
    const unknown = only(matchOrders([orderEmail()]));
    expect(unknown.merchant.policy).toMatchObject({
      returnWindowDays: null,
      windowAnchor: null,
      policySource: null,
      policyQuote: null,
      nonReturnable: false,
    });
  });

  it("marks final-sale orders non-returnable from the quote or the confirmation text", () => {
    const fromQuote = only(
      matchOrders([orderEmail({ fields: { policyQuote: "FINAL SALE: clearance items cannot be returned or exchanged." } })]),
    );
    expect(fromQuote.merchant.policy.nonReturnable).toBe(true);
    const fromText = only(matchOrders([orderEmail({ text: "Perishable grocery items are final sale." })]));
    expect(fromText.merchant.policy.nonReturnable).toBe(true);
  });

  it("propagates the lowest confidence and flags review below the threshold", () => {
    const order = only(
      matchOrders([orderEmail(), input({ id: "refund", cls: "refund", date: "2026-09-20T12:00:00Z", fields: { eventAmount: 50 }, confMin: 0.6 })]),
    );
    expect(order.confMin).toBe(0.6);
    expect(order.needsReview).toBe(true);
    expect(order.events[0].conf).toBe(0.6);
  });

  it("flags orders without a confirmation for review", () => {
    const order = only(matchOrders([input({ id: "shipped", cls: "shipped", date: "2026-09-02T12:00:00Z", fields: { lineItems: [JACKET] } })]));
    expect(order.needsReview).toBe(true);
    expect(order.total).toBe(80);
  });

  it("computes a missing total from line items, tax, shipping and discount", () => {
    const order = only(
      matchOrders([orderEmail({ fields: { lineItems: [JACKET, SOCKS], totals: { tax: 8, shipping: 5, discount: 3 } } })]),
    );
    expect(order.total).toBe(110);
  });
});

describe("matchOrdersWithReasons: odd amounts go to review (#93)", () => {
  it("flags a discount larger than the subtotal (negative computed total) instead of producing a negative order", () => {
    const { orders, reviewReasons } = matchOrdersWithReasons([
      orderEmail({ fields: { lineItems: [SOCKS], totals: { subtotal: 20, discount: 30 } } }),
    ]);
    const order = only(orders);
    expect(NormalizedOrderSchema.parse(order)).toEqual(order);
    expect(order.total).toBe(-10);
    expect(order.needsReview).toBe(true);
    expect(reviewReasons.get(order.id)).toEqual(["total is negative (-10.00)"]);
  });

  it("flags negative extracted totals and event amounts", () => {
    const { orders, reviewReasons } = matchOrdersWithReasons([
      orderEmail({ fields: { lineItems: [JACKET], totals: { subtotal: 80, tax: -8, total: -5 } } }),
      input({ id: "refund", cls: "refund", date: "2026-09-20T12:00:00Z", fields: { eventAmount: -40 } }),
    ]);
    const order = only(orders);
    expect(order.needsReview).toBe(true);
    expect(reviewReasons.get(order.id)).toEqual([
      "tax is negative (-8.00)",
      "total is negative (-5.00)",
      "event amount in email refund is negative (-40.00)",
    ]);
  });

  it("routes non-finite amounts to review without failing order validation", () => {
    const { orders, reviewReasons } = matchOrdersWithReasons([
      orderEmail({ fields: { lineItems: [JACKET], totals: { subtotal: Number.NaN, total: Number.POSITIVE_INFINITY } } }),
      input({ id: "refund", cls: "refund", date: "2026-09-20T12:00:00Z", fields: { eventAmount: Number.NaN } }),
    ]);
    const order = only(orders);
    expect(NormalizedOrderSchema.parse(order)).toEqual(order);
    expect(order).toMatchObject({ subtotal: null, total: 0, needsReview: true });
    expect(order.events[0].amount).toBeUndefined();
    expect(reviewReasons.get(order.id)).toEqual([
      "subtotal is not a number",
      "total is not a number",
      "event amount in email refund is not a number",
    ]);
  });

  it("has no reasons for a clean order", () => {
    const { orders, reviewReasons } = matchOrdersWithReasons([orderEmail()]);
    expect(only(orders).needsReview).toBe(false);
    expect(reviewReasons.size).toBe(0);
  });
});

describe("matchOrders: extracted dates are parsed as UTC (#93)", () => {
  // A non-UTC server zone: parsing offset-less dates as local time would shift them by 5:30.
  beforeEach(() => vi.stubEnv("TZ", "Asia/Kolkata"));
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["2026-09-01T18:30:00", "2026-09-01T18:30:00.000Z"],
    ["2026-09-01T18:30", "2026-09-01T18:30:00.000Z"],
    ["2026-09-01 18:30:00", "2026-09-01T18:30:00.000Z"],
    ["2026-09-01T18:30:00Z", "2026-09-01T18:30:00.000Z"],
    ["2026-09-01T18:30:00+05:30", "2026-09-01T13:00:00.000Z"],
    ["2026-09-01T18:30:00-0400", "2026-09-01T22:30:00.000Z"],
  ])("reads %s as %s regardless of the server time zone", (date, placedAt) => {
    const order = only(matchOrders([orderEmail({ fields: { date } })]));
    expect(order.placedAt).toBe(placedAt);
    expect(order.needsReview).toBe(false);
  });

  it("uses UTC for offset-less event datetimes too", () => {
    const order = only(
      matchOrders([orderEmail(), input({ id: "delivered", cls: "delivered", date: "2026-09-05T12:00:00Z", fields: { date: "2026-09-05T23:30:00" } })]),
    );
    expect(order.events[0].at).toBe("2026-09-05T23:30:00.000Z");
  });

  it.each(["October 5, 2026", "10/05/2026", "2026-02-30", "2026-09-01T25:00:00", "yesterday"])(
    "marks the non-ISO date %j low confidence, uses the email date and sends the order to review",
    (date) => {
      const { orders, reviewReasons } = matchOrdersWithReasons([
        orderEmail(),
        input({ id: "refund", cls: "refund", date: "2026-09-20T12:00:00Z", fields: { eventAmount: 50, date } }),
      ]);
      const order = only(orders);
      expect(order.events[0]).toMatchObject({ at: "2026-09-20T12:00:00.000Z", conf: 0.5 });
      expect(order.confMin).toBe(0.5);
      expect(order.needsReview).toBe(true);
      expect(reviewReasons.get(order.id)).toEqual([`date ${JSON.stringify(date)} in email refund is not ISO 8601; used the email date`]);
    },
  );

  it("does not flag a missing date", () => {
    const order = only(matchOrders([orderEmail({ fields: { date: null } })]));
    expect(order.placedAt).toBe("2026-09-01T10:00:00.000Z");
    expect(order.needsReview).toBe(false);
  });
});
