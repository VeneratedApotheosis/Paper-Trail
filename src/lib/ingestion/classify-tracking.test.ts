import { describe, expect, it } from "vitest";
import type { RawEmail } from "@/lib/contracts";
import { classify } from "./classify";

// Tracking emails are lifecycle classes (#127). Synthetic look-alikes; no real data.
const mail = (from: string, subject: string, text: string): RawEmail => ({ id: "x", from, subject, date: "2026-10-04T12:00:00Z", text });
const classOf = (from: string, subject: string, text = "") => classify(mail(from, subject, text)).class;

describe("classify: English tracking updates", () => {
  it.each([
    ["Your UPS package is arriving today", "shipped"],
    ["Shipping label created for your order", "shipped"],
    ["Delivery attempted: we missed you", "shipped"],
    ["Your package is ready for pickup", "shipped"],
    ["Package update: tracking number 1Z999AA10123456784", "shipped"],
    ["Delivered: your package", "delivered"],
    ["Your order has been picked up from the store", "delivered"],
  ])("%s -> %s", (subject, expected) => {
    expect(classOf('"Carrier" <noreply@fedex.com>', subject, "Tracking number: 794644790138")).toBe(expected);
  });

  it("keeps a carrier update that carries newsletter footers", () => {
    const text = "Your package is out for delivery today.\nTracking number: 1Z999AA10123456784\nShop the sale! 20% off. Unsubscribe. Limited time deals.";
    expect(classOf('"UPS" <pkginfo@ups.com>', "UPS Update: Package Scheduled for Delivery Today", text)).toBe("shipped");
  });

  it("does not downgrade 'Order #X confirmed' that lists a tracking label", () => {
    expect(classOf('"Lumen Beauty" <orders@lumen-beauty.example>', "Order #LB-7001 confirmed", "Order total: $46.00\nTracking number: 612345678901")).toBe("order");
  });
});

describe("classify: Traditional Chinese flows", () => {
  it.each([
    ["已出貨", "shipped"],
    ["出貨通知", "shipped"],
    ["配送中", "shipped"],
    ["運送中", "shipped"],
    ["已到店", "shipped"],
    ["到店通知", "shipped"],
    ["可取貨", "shipped"],
    ["已取貨", "delivered"],
    ["已送達", "delivered"],
    ["已簽收", "delivered"],
  ])("%s -> %s", (word, expected) => {
    expect(classOf('"Shop" <noreply@teahouse.example>', `您的包裹${word}`, `物流單號：G12345678901\n${word}`)).toBe(expected);
  });

  it("recognises convenience-store, carrier and marketplace senders", () => {
    expect(classOf('"7-ELEVEN 統一超商" <noreply@7-11.com.tw>', "【7-ELEVEN】到店通知", "您的包裹已到店")).toBe("shipped");
    expect(classOf('"全家 FamilyMart" <noreply@family.com.tw>', "取貨通知", "您的包裹可取貨")).toBe("shipped");
    expect(classOf('"黑貓宅急便" <service@t-cat.com.tw>', "配送中", "")).toBe("shipped");
    expect(classOf('"蝦皮購物" <noreply@shopee.tw>', "【蝦皮購物】您的訂單已出貨", "")).toBe("shipped");
    expect(classOf('"momo購物網" <service@momoshop.com.tw>', "您的訂單已出貨", "")).toBe("shipped");
    expect(classOf('"PChome 24h" <service@pchome.com.tw>', "訂單已送達", "")).toBe("delivered");
  });

  it("classifies a Chinese order confirmation as an order", () => {
    expect(classOf('"Tea House" <orders@teahouse.example>', "訂單成立通知 TH-5521", "訂單編號：TH-5521\n訂單總計：NT$1,280")).toBe("order");
  });

  it("does not read 'expected to arrive' (預計送達) as delivered", () => {
    expect(classOf('"Tea House" <orders@teahouse.example>', "訂單 TH-5521 已出貨", "預計送達日期：2026-10-10")).toBe("shipped");
  });
});

describe("classify: tracking safety", () => {
  it("rejects a fake carrier: display name UPS on an unrelated domain", () => {
    const verdict = classify(mail('"UPS" <delivery@ups-parcel-notice.example>', "UPS: your package is on its way, confirm now", "Tracking number: 1Z999AA10123456785\nClick to reschedule."));
    expect(verdict.class).toBe("not_receipt");
  });

  it("never lets a brand on an unrelated domain become a shipment with its own name", () => {
    expect(classOf('"FedEx" <track@fedex-notify.example>', "Your FedEx package is out for delivery", "Tracking number: 794644790138")).toBe("not_receipt");
  });

  it("does not treat a promo mentioning shipping as tracking", () => {
    expect(classOf('"Deals" <deals@shop.example>', "Free shipping this weekend", "Shop now! 30% off, limited time, unsubscribe")).not.toBe("shipped");
  });
});
