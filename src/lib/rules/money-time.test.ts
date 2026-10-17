import { describe, expect, it } from "vitest";
import { refundTolerance, roundCents, sumMoney, sumMoneyBy } from "./money";
import { addDays, daysBetween, toDateString } from "./time";

describe("money", () => {
  it.each([
    [1.005, 1.01],
    [21.599999, 21.6],
    [0.1 + 0.2, 0.3],
    [10, 10],
  ])("roundCents(%d) = %d", (input, expected) => {
    expect(roundCents(input)).toBe(expected);
  });

  it("sums amounts to cents", () => {
    expect(sumMoney([0.1, 0.2, 0.3])).toBe(0.6);
    expect(sumMoney([])).toBe(0);
    expect(sumMoneyBy([{ qty: 2, price: 10.1 }, { qty: 1, price: 0.05 }], (i) => i.qty * i.price)).toBe(20.25);
  });

  it.each([
    [10, 0.5],
    [25, 0.5],
    [100, 2],
    [113, 2.26],
  ])("refundTolerance(%d) = max(0.50, 2%%) = %d", (expected, tolerance) => {
    expect(refundTolerance(expected)).toBeCloseTo(tolerance, 10);
  });
});

describe("time", () => {
  const t = new Date("2026-09-20T12:00:00.000Z");

  it("adds 24h UTC periods", () => {
    expect(addDays(t, 10).toISOString()).toBe("2026-09-30T12:00:00.000Z");
    expect(addDays(t, -3).toISOString()).toBe("2026-09-17T12:00:00.000Z");
    expect(t.toISOString()).toBe("2026-09-20T12:00:00.000Z");
  });

  it("counts whole days between dates", () => {
    expect(daysBetween(t, new Date("2026-09-30T12:00:00.000Z"))).toBe(10);
    expect(daysBetween(t, new Date("2026-09-30T11:59:59.000Z"))).toBe(9);
    expect(daysBetween(t, new Date("2026-09-17T12:00:00.000Z"))).toBe(-3);
  });

  it("formats UTC calendar dates", () => {
    expect(toDateString(new Date("2026-09-20T23:30:00-05:00"))).toBe("2026-09-21");
  });
});
