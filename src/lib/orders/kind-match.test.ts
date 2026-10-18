import { describe, expect, it } from "vitest";
import type { ExtractedFields, RawEmail } from "@/lib/contracts";
import { matchOrders, type MatchInput } from "./matcher";
import { extractionOfTracking, rawEmailOfTracking, trackingSpec, type TrackingSpec } from "./tracking-fixtures";

const base: TrackingSpec = { id: "k", purchase: "k", cls: "order", from: '"Shop" <orders@shop.example>', subject: "Your receipt", date: "2026-09-01T10:00:00Z", text: "Total $10", merchant: "Shop", domain: "shop.example", total: 10 };
const build = (overrides: Partial<TrackingSpec>, fields: Partial<ExtractedFields> = {}): MatchInput => {
  const spec = { ...base, ...overrides };
  const extraction = extractionOfTracking(spec);
  return { email: rawEmailOfTracking(spec) as RawEmail, extraction: { ...extraction, fields: { ...extraction.fields, ...fields } } };
};

describe("order kind and details in the matcher (#127)", () => {
  it("food delivery: restaurant and delivered time", () => {
    const orders = matchOrders([
      build({ id: "f1", merchant: "DoorDash", domain: "doordash.com", from: '"DoorDash" <no-reply@doordash.com>', ref: "DD-4455", subject: "Order #DD-4455 confirmed" }, { restaurant: "Noodle Bar" }),
      build({ id: "f2", cls: "delivered", merchant: "DoorDash", domain: "doordash.com", from: '"DoorDash" <no-reply@doordash.com>', ref: "DD-4455", subject: "Your order #DD-4455 was delivered", date: "2026-09-01T11:00:00Z", total: undefined }),
    ]);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ kind: "food_delivery", details: { kind: "food_delivery", restaurant: "Noodle Bar", deliveredAt: "2026-09-01T11:00:00.000Z" } });
    expect(orders[0].packageOnly).toBeUndefined();
  });

  it("a food-delivery 'delivered' email without receipt is not a package entry", () => {
    const [order] = matchOrders([build({ id: "f3", cls: "delivered", merchant: "Uber Eats", domain: "ubereats.com", from: '"Uber Eats" <no-reply@ubereats.com>', subject: "Your order was delivered", total: undefined })]);
    expect(order.kind).toBe("food_delivery");
    expect(order.packageOnly).toBeUndefined();
    expect(order.needsReview).toBe(true);
  });

  it("subscription: wording gives plan and interval, a repeated charge makes both months subscriptions", () => {
    const [renewal] = matchOrders([build({ id: "s1", ref: "SUB-1", text: "Your subscription renewed. Billed monthly.\nCloud Plus x1 9.99\nTotal $9.99", total: 9.99, items: [["Cloud Plus", 1, 9.99]] }, { subscription: { nextRenewal: "2026-10-01" } })]);
    expect(renewal.details).toEqual({ kind: "subscription", plan: "Cloud Plus", interval: "month", nextRenewal: "2026-10-01" });
    const charges = matchOrders([
      build({ id: "r1", ref: "R-1", total: 7.5, date: "2026-08-01T10:00:00Z" }),
      build({ id: "r2", ref: "R-2", total: 7.5, date: "2026-09-01T10:00:00Z" }),
    ]);
    expect(charges.map((order) => order.kind)).toEqual(["subscription", "subscription"]);
  });

  it("digital: the platform comes from the table when the email names none", () => {
    const [order] = matchOrders([build({ id: "d1", merchant: "Apple", domain: "apple.com", from: '"Apple" <no_reply@email.apple.com>', text: "Receipt from the App Store\nTotal $4.99", total: 4.99 })]);
    expect(order).toMatchObject({ kind: "digital", details: { kind: "digital", platform: "App Store" } });
  });

  it("travel segments and the model's kind guess as a fallback", () => {
    const [trip] = matchOrders([build({ id: "t1", merchant: "Starlux Airlines", domain: "starlux-airlines.com", from: '"Starlux" <noreply@starlux-airlines.com>', total: 300 }, { travel: { confirmation: "ABC123", segments: [{ label: "TPE to NRT", start: "2026-11-02T08:00:00Z", end: null }] } })]);
    expect(trip.details).toEqual({ kind: "travel", segments: [{ label: "TPE to NRT", start: "2026-11-02T08:00:00Z", end: null }], confirmation: "ABC123" });
    const [guessed] = matchOrders([build({ id: "g1" }, { kindGuess: "in_store", storeLocation: "Main St" })]);
    expect(guessed).toMatchObject({ kind: "in_store", details: { kind: "in_store", location: "Main St" } });
    const [lowConfidence] = matchOrders([build({ id: "g2", confMin: 0.5 }, { kindGuess: "in_store" })]);
    expect(lowConfidence.kind).toBe("other");
    expect(lowConfidence.details).toEqual({ kind: "other" });
  });

  it("every order has a kind that matches its details", () => {
    const orders = matchOrders(["bkb-confirmed", "tea-order", "pkg-shipped"].map((id) => ({ email: rawEmailOfTracking(trackingSpec(id)), extraction: extractionOfTracking(trackingSpec(id)) })));
    for (const order of orders) expect(order.details?.kind).toBe(order.kind);
  });
});
