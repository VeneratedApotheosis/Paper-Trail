import { describe, expect, it } from "vitest";
import { GoldLabelsFileSchema, SeedInboxSchema } from "@/lib/contracts";
import { prepareForLlm, type RedactionMode } from "@/lib/ingestion";
import { extractionFromGoldLabel } from "@/lib/pipeline/gold";
import goldJson from "../../../seed/gold_labels.json";
import inboxJson from "../../../seed/inbox.json";
import { runEval, type ExtractionMap } from "./run";

const inbox = SeedInboxSchema.parse(inboxJson);
const labels = GoldLabelsFileSchema.parse(goldJson).labels;

/** A stand-in "model" cache built from gold labels, used only to test the extraction-map plumbing. */
function goldExtractionMap(model: string, mode?: RedactionMode): ExtractionMap {
  const map: ExtractionMap = {};
  for (const email of inbox.emails) {
    const label = labels.find((candidate) => candidate.emailId === email.id);
    if (!label || label.class === "marketing" || label.class === "not_receipt") continue;
    map[prepareForLlm(email, mode).textHash] = { ...extractionFromGoldLabel(email, label), model };
  }
  return map;
}

describe.each(["on", "off"] as const)("runEval with redaction %s", (mode) => {
  it("finds a cached extraction by the same textHash the pipeline caches under", () => {
    const report = runEval({ extractionSource: goldExtractionMap("test-model", mode), redaction: mode, split: "all" });
    if (report.extraction.status !== "ok") throw new Error("expected extraction metrics");
    expect(report.extraction.emailsMissing).toEqual([]);
    expect(report.findings.realisticRouting.emailsMissingExtraction).toEqual([]);
    expect(report.findings.realisticRouting.recall).toBe(runEval().findings.realisticRouting.recall);
    expect(report.findings.realisticRouting.precision).toBe(runEval().findings.realisticRouting.precision);
  });
});

describe("runEval", () => {
  it("reports seed counts, sources, asOf and the caller's timestamp", () => {
    const report = runEval({ now: new Date("2026-10-18T00:00:00Z") });
    expect(report.synthetic).toBe(true);
    expect(report.generatedAt).toBe("2026-10-18T00:00:00.000Z");
    expect(report.asOf).toBe(inbox.asOf);
    expect(report.counts).toMatchObject({ emails: 78, dev: 63, holdout: 15, expectedFindings: 14 });
    expect(report.sources.priceFeed).toContain("simulated");
    expect(report.findings.realisticRouting.extractionSource).toContain("gold");
  });

  it("leaves the timestamp null when no clock is supplied", () => {
    expect(runEval().generatedAt).toBeNull();
  });

  it("does not report extraction accuracy without an extraction map", () => {
    expect(runEval().extraction).toEqual({ status: "not_run", reason: "no LLM extraction cache; run with a key" });
  });

  it("scores an extraction map by textHash and uses it for realistic routing", () => {
    const report = runEval({ extractionSource: goldExtractionMap("test-model"), split: "holdout" });
    if (report.extraction.status !== "ok") throw new Error("expected extraction metrics");
    expect(report.extraction.models).toEqual(["test-model"]);
    expect(report.extraction.split).toBe("holdout");
    expect(report.extraction.emailsMissing).toEqual([]);
    expect(report.extraction.emailsScored).toBe(15);
    expect(report.extraction.overallAccuracy).toBe(1);
    expect(report.findings.realisticRouting.extractionSource).toContain("test-model");
    expect(report.findings.realisticRouting.recall).toBe(runEval().findings.realisticRouting.recall);
  });

  it("lists routed emails missing from the extraction map instead of dropping them silently", () => {
    const report = runEval({ extractionSource: {} });
    expect(report.findings.realisticRouting.emailsExtracted).toBe(0);
    expect(report.findings.realisticRouting.emailsMissingExtraction.length).toBeGreaterThan(0);
    if (report.extraction.status !== "ok") throw new Error("expected extraction metrics");
    expect(report.extraction.emailsMissing).toHaveLength(report.counts.goldReceiptEmails);
  });

  it("restricts misclassified emails to the requested split", () => {
    const holdout = runEval({ split: "holdout" }).classification.misclassified;
    expect(holdout.every((email) => email.holdout)).toBe(true);
  });
});
