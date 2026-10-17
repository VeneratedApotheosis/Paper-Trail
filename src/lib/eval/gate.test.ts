// CI gate for the eval harness (issue #21): realistic-routing finding recall >= 0.90 and precision >= 0.95,
// no phishing/marketing email routed as an order, and a 15-email holdout set. Thresholds are fixed; do not lower them.
import { describe, expect, it } from "vitest";
import { runEval } from "./run";

const RECALL_GATE = 0.9;
const PRECISION_GATE = 0.95;
const HOLDOUT_SIZE = 15;

const report = runEval();
const realistic = report.findings.realisticRouting;

describe("eval CI gate", () => {
  it("has a 15-email holdout set", () => {
    expect(report.counts.holdout).toBe(HOLDOUT_SIZE);
    expect(report.classification.splits.holdout.total).toBe(HOLDOUT_SIZE);
  });

  it("routes no phishing or marketing email to an order class", () => {
    expect(report.classification.safety.phishingOrMarketingAsOrderEmails).toEqual([]);
    expect(report.classification.safety.phishingOrMarketingAsOrder).toBe(0);
  });

  it("oracle extraction reproduces expected_findings.json exactly (pipeline sanity)", () => {
    const oracle = report.findings.oracleExtraction;
    expect(oracle.falseNegatives).toEqual([]);
    expect(oracle.falsePositives).toEqual([]);
    expect(oracle.recall).toBe(1);
    expect(oracle.precision).toBe(1);
  });

  it("realistic-routing finding recall >= 0.90", () => {
    expect(realistic.recall, JSON.stringify(realistic.falseNegatives)).toBeGreaterThanOrEqual(RECALL_GATE);
  });

  it("realistic-routing finding precision >= 0.95", () => {
    expect(realistic.precision, JSON.stringify(realistic.falsePositives)).toBeGreaterThanOrEqual(PRECISION_GATE);
  });
});
