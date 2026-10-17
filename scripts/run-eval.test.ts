// Writes the eval report for the synthetic seed (issue #21). tsx is not installed, so vitest runs the script.
//   Write:  $env:WRITE_EVAL='1'; npx vitest run scripts/run-eval.test.ts   -> eval/latest.json + summary table
// Without WRITE_EVAL=1 this file is a no-op (the CI gate lives in src/lib/eval/gate.test.ts).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runEval, type EvalReport } from "@/lib/eval/run";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const outputPath = join(repoRoot, "eval", "latest.json");
const writeMode = process.env.WRITE_EVAL === "1";

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function summaryRows(report: EvalReport): Record<string, string>[] {
  const { classification, findings, extraction } = report;
  const rows: Record<string, string>[] = (["all", "dev", "holdout"] as const).map((split) => {
    const metrics = classification.splits[split];
    return {
      metric: `classifier ${split} (n=${metrics.total})`,
      value: `accuracy ${percent(metrics.accuracy)}, macro-F1 ${metrics.macroF1.toFixed(3)}`,
    };
  });
  rows.push({ metric: "phishing/marketing routed as order", value: String(classification.safety.phishingOrMarketingAsOrder) });
  rows.push({
    metric: "extraction field accuracy",
    value: extraction.status === "ok" ? `${percent(extraction.overallAccuracy)} (${extraction.source})` : `not run: ${extraction.reason}`,
  });
  for (const mode of [findings.oracleExtraction, findings.realisticRouting]) {
    rows.push({
      metric: `findings ${mode.mode}`,
      value: `P ${percent(mode.precision)}, R ${percent(mode.recall)} (${mode.truePositives}/${mode.expected} found, ${mode.falsePositives.length} false alarms)`,
    });
  }
  return rows;
}

describe("eval report", () => {
  it.skipIf(!writeMode)("writes eval/latest.json and prints a summary", () => {
    const report = runEval({ now: new Date() });
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.table(summaryRows(report));
    expect(report.counts.emails).toBeGreaterThan(0);
  });
});
