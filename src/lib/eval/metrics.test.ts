import { describe, expect, it } from "vitest";
import type { ExpectedFinding, ExtractedFields } from "@/lib/contracts";
import {
  classificationMetrics,
  extractionFieldMetrics,
  fieldMatches,
  findingMetrics,
  isoDay,
  lineItemListsMatch,
  type ComparableFinding,
} from "./metrics";

describe("classificationMetrics", () => {
  // gold:      order order order shipped shipped refund
  // predicted: order order shipped shipped order refund
  const metrics = classificationMetrics([
    { gold: "order", predicted: "order" },
    { gold: "order", predicted: "order" },
    { gold: "order", predicted: "shipped" },
    { gold: "shipped", predicted: "shipped" },
    { gold: "shipped", predicted: "order" },
    { gold: "refund", predicted: "refund" },
  ]);

  it("computes accuracy and per-class precision/recall/F1", () => {
    expect(metrics.total).toBe(6);
    expect(metrics.correct).toBe(4);
    expect(metrics.accuracy).toBeCloseTo(4 / 6, 10);
    // order: tp 2, predicted 3, support 3 -> P 2/3, R 2/3, F1 2/3
    expect(metrics.perClass.order).toMatchObject({ support: 3, predicted: 3 });
    expect(metrics.perClass.order?.precision).toBeCloseTo(2 / 3, 10);
    expect(metrics.perClass.order?.recall).toBeCloseTo(2 / 3, 10);
    expect(metrics.perClass.order?.f1).toBeCloseTo(2 / 3, 10);
    // shipped: tp 1, predicted 2, support 2 -> P 0.5, R 0.5, F1 0.5
    expect(metrics.perClass.shipped?.f1).toBeCloseTo(0.5, 10);
    expect(metrics.perClass.refund).toEqual({ precision: 1, recall: 1, f1: 1, support: 1, predicted: 1 });
  });

  it("macro-F1 averages F1 over classes seen in gold or predictions", () => {
    expect(metrics.macroF1).toBeCloseTo((2 / 3 + 0.5 + 1) / 3, 10);
  });

  it("builds a confusion matrix keyed gold -> predicted", () => {
    expect(metrics.confusion).toEqual({
      order: { order: 2, shipped: 1 },
      shipped: { shipped: 1, order: 1 },
      refund: { refund: 1 },
    });
  });

  it("scores a class that is only predicted (never gold) as F1 0", () => {
    const onlyPredicted = classificationMetrics([
      { gold: "order", predicted: "order" },
      { gold: "order", predicted: "marketing" },
    ]);
    expect(onlyPredicted.perClass.marketing).toEqual({ precision: 0, recall: 0, f1: 0, support: 0, predicted: 1 });
    // order: P 1, R 0.5, F1 2/3; marketing: 0 -> macro 1/3
    expect(onlyPredicted.macroF1).toBeCloseTo(1 / 3, 10);
  });

  it("returns zeros for an empty sample", () => {
    expect(classificationMetrics([])).toMatchObject({ total: 0, accuracy: 0, macroF1: 0 });
  });
});

describe("fieldMatches", () => {
  it("compares strings ignoring case and whitespace", () => {
    expect(fieldMatches("merchant", "Northwind  Outfitters", " northwind outfitters ")).toBe(true);
    expect(fieldMatches("orderRef", "NW-48213", "NW-48214")).toBe(false);
  });

  it("compares numbers within $0.01", () => {
    expect(fieldMatches("eventAmount", 100.2, 100.21)).toBe(true);
    expect(fieldMatches("eventAmount", 100.2, 100.22)).toBe(false);
    expect(fieldMatches("returnWindowDays", 30, 30)).toBe(true);
  });

  it("compares dates by YYYY-MM-DD", () => {
    expect(fieldMatches("date", "2026-07-22", "2026-07-22T15:04:00-07:00")).toBe(true);
    expect(fieldMatches("date", "2026-07-22", "2026-07-23")).toBe(false);
    expect(isoDay("not a date")).toBeNull();
  });

  it("requires null gold values to be missing", () => {
    expect(fieldMatches("orderRef", null, null)).toBe(true);
    expect(fieldMatches("orderRef", null, undefined)).toBe(true);
    expect(fieldMatches("orderRef", null, "X-1")).toBe(false);
    expect(fieldMatches("orderRef", "X-1", null)).toBe(false);
  });

  it("compares totals key by key within $0.01 and only for gold keys", () => {
    expect(fieldMatches("totals", { total: 134.22, tax: 10.23 }, { total: 134.225, tax: 10.23, shipping: 0 })).toBe(true);
    expect(fieldMatches("totals", { total: 134.22 }, { total: 130 })).toBe(false);
    expect(fieldMatches("totals", { total: 134.22 }, {})).toBe(false);
  });

  it("treats a missing isStoreCredit as false", () => {
    expect(fieldMatches("isStoreCredit", true, undefined)).toBe(false);
    expect(fieldMatches("isStoreCredit", false, undefined)).toBe(true);
  });
});

describe("lineItemListsMatch", () => {
  const towel = { name: "Bath Towel Set", sku: "GM-TWL-4PK", qty: 1, unitPrice: 34 };
  const fryer = { name: "Air Fryer, 6 qt", sku: "GM-AF-600", qty: 1, unitPrice: 89.99 };

  it("matches as a multiset regardless of order, by sku when both have one", () => {
    expect(lineItemListsMatch([towel, fryer], [{ ...fryer, name: "air fryer" }, towel])).toBe(true);
  });

  it("falls back to the normalized name when a sku is missing", () => {
    expect(lineItemListsMatch([towel], [{ name: "bath towel  set", sku: null, qty: 1, unitPrice: 34.005 }])).toBe(true);
  });

  it("rejects different qty, price beyond $0.01, or count", () => {
    expect(lineItemListsMatch([towel], [{ ...towel, qty: 2 }])).toBe(false);
    expect(lineItemListsMatch([towel], [{ ...towel, unitPrice: 34.02 }])).toBe(false);
    expect(lineItemListsMatch([towel], [towel, fryer])).toBe(false);
    expect(lineItemListsMatch([towel, towel], [towel, { ...towel, qty: 2 }])).toBe(false);
  });
});

describe("extractionFieldMetrics", () => {
  const actual: ExtractedFields = {
    merchant: "Grandmart",
    orderRef: "GM-1",
    date: "2026-07-22",
    currency: "USD",
    lineItems: [],
    totals: { total: 10 },
  };

  it("scores only gold fields and reports per-field and overall accuracy", () => {
    const metrics = extractionFieldMetrics([
      { emailId: "a", gold: { merchant: "grandmart", orderRef: "GM-1", totals: { total: 10 } }, actual },
      { emailId: "b", gold: { merchant: "Grandmart", orderRef: "GM-2" }, actual },
    ]);
    expect(metrics.emailsScored).toBe(2);
    expect(metrics.perField.merchant).toEqual({ correct: 2, total: 2, accuracy: 1 });
    expect(metrics.perField.orderRef).toEqual({ correct: 1, total: 2, accuracy: 0.5 });
    expect(metrics.perField.totals).toEqual({ correct: 1, total: 1, accuracy: 1 });
    expect(metrics.perField.date).toBeUndefined();
    expect(metrics.overallAccuracy).toBeCloseTo(4 / 5, 10);
    expect(metrics.mismatches).toEqual([{ emailId: "b", field: "orderRef", gold: "GM-2", actual: "GM-1" }]);
  });
});

describe("findingMetrics", () => {
  const overdue: ExpectedFinding = {
    kind: "refund_overdue",
    merchant: "Northwind Outfitters",
    orderRef: "NW-48213",
    amountAtStake: 111.24,
    dueDate: "2026-10-10",
    messageIds: ["nw-48213-order"],
  };
  const drop: ExpectedFinding = {
    kind: "price_drop",
    merchant: "Voltline Electronics",
    orderRef: "VL-1",
    lineItem: "Headphones",
    amountAtStake: 20,
    messageIds: ["vl-1-order"],
  };
  const actualOverdue: ComparableFinding = {
    kind: "refund_overdue",
    merchant: "northwind outfitters",
    orderRef: "nw-48213",
    amountAtStake: 111.245,
    dueDate: "2026-10-10",
  };
  const actualDrop: ComparableFinding = {
    kind: "price_drop",
    merchant: "Voltline Electronics",
    orderRef: "VL-1",
    lineItem: "Headphones",
    amountAtStake: 20,
    dueDate: "2026-10-30",
  };

  it("matches on kind, merchant, orderRef, lineItem, amount within $0.01 and expected dueDate", () => {
    const metrics = findingMetrics([actualOverdue, actualDrop], [overdue, drop]);
    expect(metrics).toMatchObject({ expected: 2, actual: 2, truePositives: 2, precision: 1, recall: 1, f1: 1 });
  });

  it("counts a wrong amount as one false positive and one false negative", () => {
    const wrongAmount = { ...actualOverdue, amountAtStake: 103 };
    const metrics = findingMetrics([wrongAmount, actualDrop], [overdue, drop]);
    expect(metrics.truePositives).toBe(1);
    expect(metrics.precision).toBe(0.5);
    expect(metrics.recall).toBe(0.5);
    expect(metrics.falsePositives).toEqual([wrongAmount]);
    expect(metrics.falseNegatives).toEqual([overdue]);
  });

  it("rejects a wrong dueDate, wrong line item, or missing order ref", () => {
    expect(findingMetrics([{ ...actualOverdue, dueDate: "2026-10-11" }], [overdue]).truePositives).toBe(0);
    expect(findingMetrics([{ ...actualDrop, lineItem: "Speaker" }], [drop]).truePositives).toBe(0);
    expect(findingMetrics([{ ...actualOverdue, orderRef: null }], [overdue]).truePositives).toBe(0);
  });

  it("matches one-to-one: a duplicate actual finding is a false positive", () => {
    const metrics = findingMetrics([actualOverdue, actualOverdue], [overdue]);
    expect(metrics).toMatchObject({ truePositives: 1, precision: 0.5, recall: 1 });
    expect(metrics.f1).toBeCloseTo(2 / 3, 10);
  });

  it("scores 0 precision and recall when nothing is found", () => {
    expect(findingMetrics([], [overdue])).toMatchObject({ precision: 0, recall: 0, f1: 0, falseNegatives: [overdue] });
  });
});
