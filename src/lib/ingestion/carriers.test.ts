import { describe, expect, it } from "vitest";
import {
  carrierFromDomain,
  carrierFromName,
  carrierFromText,
  isCarrierName,
  scanTrackingNumbers,
  trackingUrlFor,
} from "./carriers";

describe("scanTrackingNumbers (#127)", () => {
  it("reads labelled English and Chinese numbers, UPS/USPS/Amazon shapes and tracking-link parameters", () => {
    expect(scanTrackingNumbers("Tracking number: 1Z999AA10123456784")).toEqual(["1Z999AA10123456784"]);
    expect(scanTrackingNumbers("Tracking | 794644790138")).toEqual(["794644790138"]);
    expect(scanTrackingNumbers("物流單號：G12345678901\n查貨號碼：123456789012")).toEqual(["G12345678901", "123456789012"]);
    expect(scanTrackingNumbers("USPS 9400 1118 9922 3344 5566 77 is on its way")).toEqual(["9400111899223344556677"]);
    expect(scanTrackingNumbers("Package TBA123456789012 shipped")).toEqual(["TBA123456789012"]);
    expect(scanTrackingNumbers("https://www.fedex.com/fedextrack/?trknbr=794644790138&x=1")).toEqual(["794644790138"]);
  });

  it("ignores order numbers, dates and words after the label", () => {
    expect(scanTrackingNumbers("Order number: BKB-9129")).toEqual([]);
    expect(scanTrackingNumbers("Track your package with tracking information below. Estimated 2026-10-14")).toEqual([]);
    expect(scanTrackingNumbers("Tracking number: pending")).toEqual([]);
  });
});

describe("tracking URLs are built by code (#127)", () => {
  it("builds public links for UPS, USPS, FedEx, DHL, Amazon, T-cat and 7-ELEVEN", () => {
    expect(trackingUrlFor("UPS", "1Z999AA10123456784")).toBe("https://www.ups.com/track?tracknum=1Z999AA10123456784");
    expect(trackingUrlFor("USPS", "9400111899223344556677")).toBe("https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223344556677");
    expect(trackingUrlFor("FedEx", "794644790138")).toBe("https://www.fedex.com/fedextrack/?trknbr=794644790138");
    expect(trackingUrlFor("DHL Express", "1234567890")).toContain("tracking-id=1234567890");
    expect(trackingUrlFor("Amazon Logistics", "TBA123456789012")).toBe("https://track.amazon.com/tracking/TBA123456789012");
    expect(trackingUrlFor("黑貓宅急便", "123456789012")).toContain("t-cat.com.tw");
    expect(trackingUrlFor("7-ELEVEN", "G12345678901")).toContain("7-11.com.tw");
  });

  it("is null where there is no public pattern, and falls back to the number's own shape", () => {
    expect(trackingUrlFor("新竹物流", "12345678")).toBeNull();
    expect(trackingUrlFor("中華郵政", "12345678")).toBeNull();
    expect(trackingUrlFor(null, "RANDOM12345")).toBeNull();
    expect(trackingUrlFor(null, "1Z999AA10123456784")).toContain("ups.com");
  });
});

describe("carrier recognition", () => {
  it("knows carriers, convenience-store networks and marketplaces by name and sender domain", () => {
    expect(carrierFromName("UPS Ground")?.id).toBe("ups");
    expect(carrierFromName("全家 FamilyMart")?.id).toBe("familymart");
    expect(carrierFromName("蝦皮購物")?.id).toBe("shopee");
    expect(carrierFromName("Groups Inc")).toBeNull();
    expect(carrierFromDomain("pkginfo.ups.com")?.id).toBe("ups");
    expect(carrierFromDomain("hct.com.tw")?.id).toBe("hct");
    expect(carrierFromDomain("ups.example")).toBeNull();
  });

  it("separates carriers from stores that are also merchants", () => {
    expect(isCarrierName("FedEx")).toBe(true);
    expect(isCarrierName("Shopee")).toBe(false);
    expect(isCarrierName("Amazon")).toBe(false);
  });

  it("reads a labelled carrier line, else the one carrier mentioned", () => {
    expect(carrierFromText("Carrier: DHL Express\nTracking number: 1234567890")?.id).toBe("dhl");
    expect(carrierFromText("Shipped with FedEx today")?.id).toBe("fedex");
    expect(carrierFromText("Choose UPS or FedEx next time")).toBeNull();
  });
});
