import type { Classification, EmailClass, ExtractedFields, Extraction, RawEmail, RedactedEmail } from "@/lib/contracts";
import { SKIPPED_EXTRACTION_CLASSES, classify, isReceiptLike, type ExtractResult, type ExtractionCache } from "@/lib/ingestion";
import { redactedEmailOfLabel } from "@/lib/quality/text";
import type { QualityLabel } from "@/lib/quality/types";
import { extractionFieldMetrics, type ExtractionFieldMetrics } from "./metrics";

/**
 * Eval on real labels (#117): scores the receipt gate (prefilter + classifier) and field extraction against the
 * corrections people made (review edits / confirms, "this is a receipt" feedback). Works on the stored redacted text.
 * Sample caveat: labels exist where something was wrong or reviewed, so precision/recall describe those examples,
 * not the whole inbox.
 */

export type RealExtractor = (email: RedactedEmail, classification: Classification) => Promise<ExtractResult>;

export interface RealEvalOptions {
  /** Re-runs extraction (a chosen model, or the live client). Takes precedence over `cache`. */
  extractor?: RealExtractor;
  /** Cache-only scoring: labels whose redacted text has no cached extraction are listed as missing, never sent to a model. */
  cache?: ExtractionCache;
}

export interface RealClassificationReport {
  /** Receipt (any receipt class) vs skipped, as the pipeline gate decides it. */
  total: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  /** Labels the gate got wrong. */
  mistakes: Array<{ emailId: string; labeled: EmailClass; predictedReceipt: boolean }>;
}

export type RealExtractionReport =
  | { status: "not_run"; reason: string }
  | ({
      status: "ok";
      /** Labels with corrected fields that were scored. */
      labelsScored: number;
      /** Labels with corrected fields but no extraction (cache miss) or a failed one. */
      unscored: Array<{ emailId: string; reason: string }>;
      models: string[];
    } & ExtractionFieldMetrics);

export interface RealEvalReport {
  counts: {
    labels: number;
    bySource: { review: number; feedback: number };
    receipts: number;
    notReceipts: number;
    withFields: number;
  };
  classification: RealClassificationReport;
  extraction: RealExtractionReport;
  caveat: string;
}

export const REAL_EVAL_CAVEAT =
  "Labels come from corrections and reviews, so these numbers describe those examples, not your whole inbox.";

const ratio = (numerator: number, denominator: number) => (denominator === 0 ? 0 : numerator / denominator);
const isReceiptClass = (value: EmailClass) => !SKIPPED_EXTRACTION_CLASSES.has(value);

function rawEmailOf(label: QualityLabel): RawEmail {
  const { id, from, subject, date, text } = redactedEmailOfLabel(label);
  return { id, from, subject, date, text };
}

function classificationReport(labels: readonly QualityLabel[]): RealClassificationReport {
  const mistakes: RealClassificationReport["mistakes"] = [];
  let truePositives = 0, falsePositives = 0, falseNegatives = 0, trueNegatives = 0;
  for (const label of labels) {
    const raw = rawEmailOf(label);
    const predictedReceipt = isReceiptLike(raw).keep && isReceiptClass(classify(raw).class);
    const labeledReceipt = isReceiptClass(label.class);
    if (labeledReceipt && predictedReceipt) truePositives++;
    else if (!labeledReceipt && predictedReceipt) falsePositives++;
    else if (labeledReceipt) falseNegatives++;
    else trueNegatives++;
    if (labeledReceipt !== predictedReceipt) mistakes.push({ emailId: label.emailId, labeled: label.class, predictedReceipt });
  }
  const precision = ratio(truePositives, truePositives + falsePositives);
  const recall = ratio(truePositives, truePositives + falseNegatives);
  return {
    total: labels.length, truePositives, falsePositives, falseNegatives, trueNegatives, precision, recall,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
    accuracy: ratio(truePositives + trueNegatives, labels.length), mistakes,
  };
}

async function extractionReport(labels: readonly QualityLabel[], options: RealEvalOptions): Promise<RealExtractionReport> {
  const scored = labels.filter((label) => label.fields !== null && isReceiptClass(label.class));
  if (!options.extractor && !options.cache) return { status: "not_run", reason: "no extractor or cache supplied" };
  const pairs: Array<{ emailId: string; gold: Partial<ExtractedFields>; actual: ExtractedFields }> = [];
  const unscored: Array<{ emailId: string; reason: string }> = [];
  const models = new Set<string>();
  for (const label of scored) {
    const email = redactedEmailOfLabel(label);
    let extraction: Extraction | undefined;
    if (options.extractor) {
      const result = await options.extractor(email, { emailId: label.emailId, class: label.class, confidence: 1 }).catch((): null => null);
      if (result?.ok) extraction = result.extraction;
      else unscored.push({ emailId: label.emailId, reason: result === null ? "extraction failed" : "reason" in result ? result.reason.slice(0, 200) : "extraction failed" });
    } else {
      extraction = options.cache?.get(label.textHash);
      if (!extraction) unscored.push({ emailId: label.emailId, reason: "no cached extraction for this email" });
    }
    if (extraction) {
      models.add(extraction.model);
      pairs.push({ emailId: label.emailId, gold: label.fields!, actual: extraction.fields });
    }
  }
  return { status: "ok", labelsScored: pairs.length, unscored, models: [...models].sort(), ...extractionFieldMetrics(pairs) };
}

/** Scores the classification gate and (when an extractor or cache is given) field extraction against saved labels. */
export async function runRealEval(labels: readonly QualityLabel[], options: RealEvalOptions = {}): Promise<RealEvalReport> {
  return {
    counts: {
      labels: labels.length,
      bySource: { review: labels.filter((label) => label.source === "review").length, feedback: labels.filter((label) => label.source === "feedback").length },
      receipts: labels.filter((label) => isReceiptClass(label.class)).length,
      notReceipts: labels.filter((label) => !isReceiptClass(label.class)).length,
      withFields: labels.filter((label) => label.fields !== null).length,
    },
    classification: classificationReport(labels),
    extraction: await extractionReport(labels, options),
    caveat: REAL_EVAL_CAVEAT,
  };
}
