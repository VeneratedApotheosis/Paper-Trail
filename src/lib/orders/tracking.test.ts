import { describe, expect, it } from "vitest";
import { NormalizedOrderSchema } from "@/lib/contracts";
import { classify } from "@/lib/ingestion/classify";
import { matchOrders, matchOrdersWithReasons } from "./matcher";
import { rawEmailOfTracking, TRACKING_SPECS, trackingInputs } from "./tracking-fixtures";
import { runRules, defaultRules } from "@/lib/rules";
import { computeOwed } from "@/lib/rules/owed";

const types = (events: { type: string }[]) => events.map((event) => event.type);
const NOW = new Date("2026-11-01T00:00:00Z");

describe("tracking emails are lifecycle classes, never 'not a receipt' (#127)", () => {
  it("classifies every shipping / tracking fixture as its own class", () => {
    for (const spec of TRACKING_SPECS) {
      expect(classify(rawEmailOfTracking(spec)).class, spec.id).toBe(spec.cls);
    }
  });
});

describe("Shopify sequence: confirmed -> on the way -> out for delivery -> delivered", () => {
  const ids = ["bkb-confirmed", "bkb-shipped", "bkb-out", "bkb-delivered"];

  it("is ONE purchase whose timeline is placed -> shipped -> out for delivery -> delivered", () => {
    const orders = matchOrders(trackingInputs(...ids));
    expect(orders).toHaveLength(1);
    const [order] = orders;
    expect(NormalizedOrderSchema.parse(order)).toEqual(order);
    expect(types(order.events)).toEqual(["placed", "shipped", "out_for_delivery", "delivered"]);
    expect(order.kind).toBe("shipped");
    expect(order.packageOnly).toBeUndefined();
    expect(order.total).toBe(129);
    expect(order.details).toMatchObject({ kind: "shipped" });
    if (order.details?.kind !== "shipped") throw new Error("expected shipped details");
    expect(order.details.shipments).toEqual([
      {
        carrier: "UPS",
        trackingNumber: "1Z999AA10123456784",
        trackingUrl: "https://www.ups.com/track?tracknum=1Z999AA10123456784",
        status: "delivered",
        eta: null,
        shippedAt: "2026-09-23T09:00:00.000Z",
        deliveredAt: "2026-09-25T14:00:00.000Z",
        itemIds: [],
        pickupLocation: null,
      },
    ]);
  });

  it("does not depend on the order the emails arrive in", () => {
    const forward = matchOrders(trackingInputs(...ids));
    const backward = matchOrders(trackingInputs(...[...ids].reverse()));
    expect(backward).toEqual(forward);
  });

  it("joins the carrier's email through the tracking number alone (tracking_number merge)", () => {
    const { orders, dedup } = matchOrdersWithReasons(trackingInputs(...ids));
    expect(orders).toHaveLength(1);
    expect(dedup.merges.tracking_number).toBeGreaterThanOrEqual(1);
  });

  it("keeps a second order of the same merchant in the same week apart", () => {
    const orders = matchOrders(trackingInputs(...ids, "bkb2-confirmed", "bkb2-shipped"));
    expect(orders).toHaveLength(2);
    const second = orders.find((order) => order.orderRef === "BKB-9130");
    expect(second?.total).toBe(18);
    expect(types(second?.events ?? [])).toEqual(["placed", "shipped"]);
    const first = orders.find((order) => order.orderRef === "BKB-9129");
    expect(first?.messageIds).not.toContain("bkb2-shipped");
    if (second?.details?.kind !== "shipped") throw new Error("expected shipped details");
    expect(second.details.shipments[0]).toMatchObject({ carrier: "USPS", trackingNumber: "9400111899223344556677", status: "shipped" });
    expect(second.details.shipments[0].trackingUrl).toBe("https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223344556677");
  });
});

describe("Traditional Chinese convenience-store pickup", () => {
  it("is one purchase: placed -> shipped -> ready for pickup -> picked up (delivered)", () => {
    const orders = matchOrders(trackingInputs("tea-order", "tea-shipped", "tea-store", "tea-picked"));
    expect(orders).toHaveLength(1);
    const [order] = orders;
    expect(types(order.events)).toEqual(["placed", "shipped", "ready_for_pickup", "delivered"]);
    expect(order.currency).toBe("TWD");
    expect(order.total).toBe(1280);
    if (order.details?.kind !== "shipped") throw new Error("expected shipped details");
    const [shipment] = order.details.shipments;
    expect(shipment).toMatchObject({
      carrier: "7-ELEVEN 統一超商",
      trackingNumber: "G12345678901",
      status: "delivered",
      pickupLocation: "信義門市",
      trackingUrl: "https://eservice.7-11.com.tw/e-tracking/search.aspx?shipNum=G12345678901",
    });
  });

  it("shows the pickup status and deadline while the package waits at the store", () => {
    const [order] = matchOrders(trackingInputs("tea-order", "tea-shipped", "tea-store"));
    if (order.details?.kind !== "shipped") throw new Error("expected shipped details");
    expect(order.details.shipments[0]).toMatchObject({ status: "ready_for_pickup", eta: "2026-10-10", deliveredAt: null });
  });
});

describe("split shipments", () => {
  it("makes one shipment per tracking number with its own items and carrier", () => {
    const orders = matchOrders(trackingInputs("split-order", "split-ship-1", "split-ship-2"));
    expect(orders).toHaveLength(1);
    const [order] = orders;
    if (order.details?.kind !== "shipped") throw new Error("expected shipped details");
    expect(order.details.shipments.map((shipment) => [shipment.carrier, shipment.trackingNumber])).toEqual([
      ["FedEx", "794644790138"],
      ["DHL", "1234567890"],
    ]);
    const throwItem = order.lineItems.find((item) => item.name === "Linen Throw")!;
    expect(order.details.shipments[0].itemIds).toEqual([throwItem.id]);
    expect(order.details.shipments[1].trackingUrl).toContain("dhl.com");
  });
});

describe("package-only groups", () => {
  const packageIds = ["pkg-shipped", "pkg-out", "pkg-delivered"];

  it("groups tracking updates with no receipt into ONE entry: kind shipped, no amount, no review flag", () => {
    const { orders, reviewReasons, lifecycle } = matchOrdersWithReasons(trackingInputs(...packageIds));
    expect(orders).toHaveLength(1);
    const [order] = orders;
    expect(order).toMatchObject({ kind: "shipped", packageOnly: true, total: 0, needsReview: false, subtotal: null });
    expect(order.merchant.name).toBe("Lumen Beauty");
    expect(order.id).toBe("order:lumen-beauty:pkg-612345678901");
    expect(types(order.events)).toEqual(["shipped", "out_for_delivery", "delivered"]);
    expect(reviewReasons.size).toBe(0);
    expect(lifecycle).toEqual({ linked: 0, orphaned: 3 });
  });

  it("never yields findings or owed money", () => {
    const orders = matchOrders(trackingInputs(...packageIds));
    const findings = runRules(orders, defaultRules, { now: NOW });
    expect(findings).toEqual([]);
    expect(computeOwed(findings, orders)).toMatchObject({ owedTotal: 0, findingCount: 0, excludedCount: 0 });
  });

  it("merges into the receipt when it arrives later (same tracking number)", () => {
    const { orders, lifecycle } = matchOrdersWithReasons(trackingInputs(...packageIds, "pkg-receipt"));
    expect(orders).toHaveLength(1);
    const [order] = orders;
    expect(order.packageOnly).toBeUndefined();
    expect(order.total).toBe(46);
    expect(order.orderRef).toBe("LB-7001");
    expect(types(order.events)).toEqual(["placed", "shipped", "out_for_delivery", "delivered"]);
    expect(lifecycle).toEqual({ linked: 3, orphaned: 0 });
  });

  it("groups a marketplace shipment and the carrier's update that has only the tracking number", () => {
    const { orders } = matchOrdersWithReasons(trackingInputs("shopee-1", "shopee-2"));
    expect(orders).toHaveLength(1);
    const [order] = orders;
    expect(order).toMatchObject({ packageOnly: true, kind: "shipped", total: 0, currency: "TWD" });
    expect(order.merchant.name).toBe("蝦皮購物");
    expect(types(order.events)).toEqual(["shipped", "out_for_delivery"]);
    if (order.details?.kind !== "shipped") throw new Error("expected shipped details");
    expect(order.details.shipments[0]).toMatchObject({
      carrier: "T-cat 黑貓宅急便",
      trackingNumber: "123456789012",
      status: "out_for_delivery",
      trackingUrl: "https://www.t-cat.com.tw/Inquire/TraceDetail.aspx?BillID=123456789012&ReturnUrl=Trace.aspx",
    });
  });

  it("does not let two different parcels from one shop become one entry", () => {
    const orders = matchOrders(trackingInputs("shopee-1", "pkg-shipped"));
    expect(orders).toHaveLength(2);
  });
});

describe("status never moves backwards", () => {
  it("keeps 'delivered' when a late 'shipped' email carries a later date", () => {
    const late = trackingInputs("bkb-confirmed", "bkb-delivered", "bkb-shipped");
    late[2] = { ...late[2], email: { ...late[2].email, date: "2026-09-27T09:00:00Z" } };
    const [order] = matchOrders(late);
    if (order.details?.kind !== "shipped") throw new Error("expected shipped details");
    expect(order.details.shipments[0].status).toBe("delivered");
  });
});

describe("tracking numbers are checked against the email text", () => {
  it("ignores a tracking number the LLM invented", () => {
    const [input] = trackingInputs("bkb-shipped");
    input.extraction.fields.shipment = { trackingNumbers: ["1Z000000000000000X", "1Z999AA10123456784"], carrier: "UPS" };
    const [order] = matchOrders([input]);
    if (order.details?.kind !== "shipped") throw new Error("expected shipped details");
    expect(order.details.shipments.map((shipment) => shipment.trackingNumber)).toEqual(["1Z999AA10123456784"]);
  });
});

describe("tracking fixture set: pairwise precision / recall (#127)", () => {
  it("puts two emails in one order exactly when the fixtures say they are one purchase", () => {
    const orders = matchOrders(trackingInputs(...TRACKING_SPECS.map((spec) => spec.id)));
    const orderOf = new Map<string, string>();
    for (const order of orders) for (const id of order.messageIds) orderOf.set(id, order.id);
    let truePositives = 0;
    const wrong: string[] = [];
    for (let a = 0; a < TRACKING_SPECS.length; a += 1) {
      for (let b = a + 1; b < TRACKING_SPECS.length; b += 1) {
        const [x, y] = [TRACKING_SPECS[a], TRACKING_SPECS[b]];
        const sameTruth = x.purchase === y.purchase;
        const sameOrder = orderOf.get(x.id) === orderOf.get(y.id);
        if (sameTruth && sameOrder) truePositives += 1;
        if (sameTruth !== sameOrder) wrong.push(`${x.id} + ${y.id}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(truePositives).toBeGreaterThan(10);
  });
});
