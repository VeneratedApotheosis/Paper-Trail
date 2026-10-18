import { describe, expect, it } from "vitest";
import {
  ExtractionSchema,
  FindingSchema,
  NormalizedOrderSchema,
  OrderEventTypeSchema,
  RawEmailSchema,
  SeedInboxSchema,
  FindingKindSchema,
  PurchaseDetailsSchema,
  PurchaseKindSchema,
  ShipmentSchema,
  ShipmentStatusSchema,
} from "./index";
import { events, findings } from "@/db/schema";

describe("contracts", () => {
  it("accepts a raw email and rejects a bad date", () => {
    const email = {
      id: "m1",
      from: '"Northwind" <orders@northwind.example>',
      subject: "Your order #NW-1001",
      date: "2026-09-01T10:00:00Z",
      text: "Thanks for your order",
    };
    expect(RawEmailSchema.parse(email).id).toBe("m1");
    expect(RawEmailSchema.safeParse({ ...email, date: "yesterday" }).success).toBe(false);
  });

  it("caps evidence at 200 chars", () => {
    const base = {
      emailId: "m1",
      class: "order",
      fields: { merchant: "Northwind", orderRef: "NW-1001", date: "2026-09-01", currency: "USD" },
      confidence: { merchant: 0.95 },
      evidence: { merchant: "x".repeat(200) },
      confMin: 0.95,
      model: "test",
    };
    expect(ExtractionSchema.safeParse(base).success).toBe(true);
    expect(
      ExtractionSchema.safeParse({ ...base, evidence: { merchant: "x".repeat(201) } }).success,
    ).toBe(false);
  });

  it("parses a normalized order and a finding", () => {
    const order = NormalizedOrderSchema.parse({
      id: "o1",
      merchant: {
        name: "Northwind",
        domain: "northwind.example",
        policy: {
          returnWindowDays: 30,
          windowAnchor: "delivery",
          refundSlaDays: null,
          priceAdjustDays: 14,
          policySource: "email_text",
          policyQuote: "Returns accepted within 30 days of delivery.",
        },
      },
      orderRef: "NW-1001",
      placedAt: "2026-09-01T10:00:00Z",
      currency: "USD",
      subtotal: 100,
      tax: 8,
      shipping: 0,
      discount: null,
      total: 108,
      last4: "4242",
      customerName: "Sam Rivera",
      lineItems: [{ id: "li1", name: "Rain shell", qty: 1, unitPrice: 100 }],
      events: [
        { id: "e1", type: "return_received", at: "2026-09-20T00:00:00Z", messageId: "m3", conf: 0.9 },
      ],
      messageIds: ["m1", "m3"],
      confMin: 0.9,
      needsReview: false,
    });
    expect(order.merchant.policy.nonReturnable).toBe(false);

    const finding = FindingSchema.parse({
      id: "refund_overdue:o1",
      kind: "refund_overdue",
      orderId: "o1",
      amountAtStake: 108,
      currency: "USD",
      dueAt: "2026-09-30T00:00:00Z",
      severity: "high",
      ruleVersion: "R1@1",
      summary: "Return received Sep 20; no refund after 10 days.",
      evidence: [{ messageId: "m3", quote: "We've received your return." }],
      explain: { slaDays: 10 },
    });
    expect(finding.status).toBe("open");
    expect(finding.simulated).toBe(false);
  });

  it("requires seed inboxes to be marked synthetic", () => {
    expect(
      SeedInboxSchema.safeParse({ synthetic: false, asOf: "2026-10-17T12:00:00Z", emails: [] }).success,
    ).toBe(false);
  });

  it("stays in sync with the DB enums", () => {
    expect(OrderEventTypeSchema.options).toEqual(events.type.enumValues);
    expect(FindingKindSchema.options).toEqual(findings.kind.enumValues);
  });
});

describe("purchase kinds and shipments (#127)", () => {
  it("covers every kind with matching details and rejects a mismatched shape", () => {
    const details = [
      { kind: "shipped", shipments: [] },
      { kind: "in_store", location: null },
      { kind: "digital", platform: "Steam" },
      { kind: "subscription", plan: "Plus", interval: "month", nextRenewal: null },
      { kind: "food_delivery", restaurant: null, deliveredAt: null },
      { kind: "travel", segments: [{ label: "TPE-NRT", start: null, end: null }], confirmation: "ABC123" },
      { kind: "other" },
    ];
    expect(details.map((item) => PurchaseDetailsSchema.parse(item).kind).sort()).toEqual([...PurchaseKindSchema.options].sort());
    expect(PurchaseDetailsSchema.safeParse({ kind: "subscription", plan: null, interval: "decade", nextRenewal: null }).success).toBe(false);
    expect(PurchaseDetailsSchema.safeParse({ kind: "shipped", location: null }).success).toBe(false);
  });

  it("has the pickup and out-for-delivery statuses and requires a tracking number", () => {
    expect(ShipmentStatusSchema.options).toEqual(expect.arrayContaining(["out_for_delivery", "ready_for_pickup", "delivered"]));
    const shipment = { carrier: null, trackingNumber: "1Z999AA10123456784", trackingUrl: null, status: "shipped", eta: null, shippedAt: null, deliveredAt: null, itemIds: [] };
    expect(ShipmentSchema.parse(shipment).trackingNumber).toBe("1Z999AA10123456784");
    expect(ShipmentSchema.safeParse({ ...shipment, trackingNumber: "" }).success).toBe(false);
    expect(ShipmentSchema.safeParse({ ...shipment, trackingUrl: "not a url" }).success).toBe(false);
  });

  it("knows the placed / out_for_delivery / ready_for_pickup events and keeps kind optional on old orders", () => {
    expect(OrderEventTypeSchema.options).toEqual(expect.arrayContaining(["placed", "out_for_delivery", "ready_for_pickup"]));
    expect(NormalizedOrderSchema.shape.kind.isOptional()).toBe(true);
    expect(NormalizedOrderSchema.shape.details.isOptional()).toBe(true);
  });
});
