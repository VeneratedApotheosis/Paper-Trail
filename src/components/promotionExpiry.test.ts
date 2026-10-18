import { describe, expect, it } from "vitest";
import { expiryLabel, minSpendNote } from "./promotionExpiry";

// Local-time constructors keep these tests independent of the machine's time zone.
const at = (month: number, day: number, hour = 12, minute = 0) => new Date(2026, month - 1, day, hour, minute);
const iso = (date: Date) => date.toISOString();

describe("expiryLabel", () => {
  const now = at(10, 17, 15);

  it("says when there is no end date", () => {
    expect(expiryLabel(null, now)).toEqual({ text: "No end date", tone: "none" });
    expect(expiryLabel("garbage", now)).toEqual({ text: "No end date", tone: "none" });
  });

  it("is urgent under 24 hours: tonight, hours, under an hour", () => {
    expect(expiryLabel(iso(at(10, 17, 23, 59)), now)).toEqual({ text: "Ends tonight", tone: "urgent" });
    expect(expiryLabel(iso(at(10, 17, 18, 30)), now)).toEqual({ text: "Ends in 3 hours", tone: "urgent" });
    expect(expiryLabel(iso(at(10, 17, 15, 40)), now)).toEqual({ text: "Ends in under an hour", tone: "urgent" });
    expect(expiryLabel(iso(at(10, 18, 9, 0)), now)).toEqual({ text: "Ends in 18 hours", tone: "urgent" });
  });

  it("counts days up to a week, then shows the date", () => {
    expect(expiryLabel(iso(at(10, 18, 23, 59)), now)).toEqual({ text: "2 days left", tone: "soon" });
    expect(expiryLabel(iso(at(10, 20, 23, 59)), now)).toEqual({ text: "4 days left", tone: "soon" });
    expect(expiryLabel(iso(at(10, 31, 23, 59)), now)).toEqual({ text: "Ends Oct 31", tone: "normal" });
  });

  it("marks ended offers as expired", () => {
    expect(expiryLabel(iso(at(10, 10, 23, 59)), now)).toEqual({ text: "Expired Oct 10", tone: "expired" });
    expect(expiryLabel(iso(now), now).tone).toBe("expired");
  });
});

describe("minSpendNote", () => {
  it("adds the minimum only when the headline does not say it", () => {
    expect(minSpendNote({ minSpend: 40, currency: "USD" }, "$10 off a $40 pickup order")).toBeNull();
    expect(minSpendNote({ minSpend: 75, currency: "USD" }, "25% off")).toBe("Minimum spend $75.00");
    expect(minSpendNote({ minSpend: null, currency: null }, "25% off")).toBeNull();
    expect(minSpendNote(null, "25% off")).toBeNull();
  });
});