import { describe, expect, it } from "vitest";
import { runEval } from "@/lib/eval/run";
import { evalViewMetrics } from "./metrics";

describe("evaluation view mapping", () => {
  it("uses held-out classifier scores and discloses oracle extraction", () => {
    const report = runEval({ now: new Date("2026-10-17T19:00:00Z") });
    const result = evalViewMetrics(report);
    const holdout = report.classification.splits.holdout;
    expect(result.headline.accuracy).toBe(holdout.accuracy);
    expect(result.headline.f1).toBe(holdout.macroF1);
    expect(result.classes.reduce((sum, row) => sum + row.support, 0)).toBe(holdout.total);
    expect(result.sampleNote).toContain(`${holdout.total} held-out synthetic emails`);
    expect(result.sampleNote).toContain("AI extraction accuracy was not measured");
    expect(result.baseline).toBeUndefined();
  });
  it("uses equal class weights for precision/recall and handles an empty sample", () => {
    const report = runEval();
    report.classification.splits.holdout.perClass = {
      order: { precision: 1, recall: 0.5, f1: 2 / 3, support: 100, predicted: 50 },
      marketing: { precision: 0.2, recall: 0.1, f1: 0.133, support: 10, predicted: 5 },
    };
    expect(evalViewMetrics(report).headline).toMatchObject({ precision: 0.6, recall: 0.3 });
    report.classification.splits.holdout.perClass = {};
    expect(evalViewMetrics(report).headline).toMatchObject({ precision: 0, recall: 0 });
  });
});
