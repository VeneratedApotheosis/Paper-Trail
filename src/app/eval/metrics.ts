import type { EvalMetrics } from "@/components/views/EvalView";
import type { EvalReport } from "@/lib/eval/run";

/** Display the held-out classifier scores, without presenting oracle extraction as measured AI accuracy. */
export function evalViewMetrics(report: EvalReport): EvalMetrics {
  const metrics = report.classification.splits.holdout;
  const rows = Object.entries(metrics.perClass).map(([label, scores]) => ({
    label: label.replaceAll("_", " "),
    precision: scores.precision,
    recall: scores.recall,
    f1: scores.f1,
    support: scores.support,
  }));
  const mean = (key: "precision" | "recall") => rows.length
    ? rows.reduce((sum, row) => sum + row[key], 0) / rows.length
    : 0;
  return {
    title: "How well we recognize receipts",
    subtitle: "Held-out synthetic emails, scored by the deterministic email classifier. These are not live AI extraction scores.",
    headline: { accuracy: metrics.accuracy, precision: mean("precision"), recall: mean("recall"), f1: metrics.macroF1 },
    breakdownLabel: "Per email class · precision, recall and F1 are macro averages above",
    classes: rows,
    sampleNote: `Scored on ${metrics.total} held-out synthetic emails from ${report.counts.emails} total. Extraction source: ${report.sources.extraction}. ${report.extraction.status === "not_run" ? "AI extraction accuracy was not measured." : "These headline scores measure classification only."} Prices in the synthetic evaluation are simulated.`,
  };
}
