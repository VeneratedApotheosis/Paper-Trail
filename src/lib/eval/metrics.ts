import type {
  EmailClass,
  ExpectedFinding,
  ExtractedFieldName,
  ExtractedFields,
  ExtractedLineItem,
  FindingKind,
} from "@/lib/contracts";

/**
 * Pure eval metric helpers (issue #21). No I/O, no clock.
 *
 * - Classification: per-class precision/recall/F1, macro-F1, accuracy, confusion matrix.
 * - Extraction: per-field exact match against gold fields (only fields present in the gold label are scored).
 * - Findings: one-to-one matching of actual vs expected findings, then precision/recall/F1.
 */

/** Money and other numbers compare within this tolerance. */
export const NUMBER_TOLERANCE = 0.01;

/** Ratio helper: 0 when the denominator is 0 (ill-defined metrics score 0, sklearn "zero_division=0"). */
function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function f1Of(precision: number, recall: number): number {
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

// ---------------------------------------------------------------------------------------------------------------
// Classification

export interface ClassScores {
  precision: number;
  recall: number;
  f1: number;
  /** Number of gold examples of this class. */
  support: number;
  /** Number of predictions of this class. */
  predicted: number;
}

export interface ClassificationMetrics {
  total: number;
  correct: number;
  accuracy: number;
  /** Mean F1 over every class that appears in gold or predictions of this sample. */
  macroF1: number;
  perClass: Partial<Record<EmailClass, ClassScores>>;
  /** confusion[gold][predicted] = count; only non-zero cells are present. */
  confusion: Partial<Record<EmailClass, Partial<Record<EmailClass, number>>>>;
}

export interface ClassificationPair {
  gold: EmailClass;
  predicted: EmailClass;
}

export function classificationMetrics(pairs: readonly ClassificationPair[]): ClassificationMetrics {
  const confusion: ClassificationMetrics["confusion"] = {};
  const classes = new Set<EmailClass>();
  let correct = 0;
  for (const { gold, predicted } of pairs) {
    classes.add(gold);
    classes.add(predicted);
    if (gold === predicted) correct++;
    const row = (confusion[gold] ??= {});
    row[predicted] = (row[predicted] ?? 0) + 1;
  }

  const perClass: ClassificationMetrics["perClass"] = {};
  for (const cls of classes) {
    const truePositives = pairs.filter((pair) => pair.gold === cls && pair.predicted === cls).length;
    const support = pairs.filter((pair) => pair.gold === cls).length;
    const predicted = pairs.filter((pair) => pair.predicted === cls).length;
    const precision = ratio(truePositives, predicted);
    const recall = ratio(truePositives, support);
    perClass[cls] = { precision, recall, f1: f1Of(precision, recall), support, predicted };
  }

  const scores = Object.values(perClass);
  return {
    total: pairs.length,
    correct,
    accuracy: ratio(correct, pairs.length),
    macroF1: ratio(
      scores.reduce((sum, score) => sum + score.f1, 0),
      scores.length,
    ),
    perClass,
    confusion,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Extraction field exact match

/** Lowercase, trim, collapse internal whitespace. */
export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Absorbs float error, e.g. 100.21 - 100.2 = 0.010000000000005. */
const FLOAT_SLACK = 1e-9;

export function numbersMatch(gold: number, actual: number): boolean {
  return Math.abs(gold - actual) <= NUMBER_TOLERANCE + FLOAT_SLACK;
}

/** YYYY-MM-DD of an ISO date/datetime string (the written date, not converted to UTC), else null. */
export function isoDay(value: string): string | null {
  const written = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (written) return written[1];
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

function isMissing(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

function optionalNumbersMatch(gold: number | null | undefined, actual: number | null | undefined): boolean {
  if (isMissing(gold) || isMissing(actual)) return isMissing(gold) && isMissing(actual);
  return numbersMatch(gold, actual);
}

/** Same item: sku when both sides have one, else normalized name; plus equal qty and unit price within $0.01. */
export function lineItemsMatch(gold: ExtractedLineItem, actual: ExtractedLineItem): boolean {
  const sameIdentity =
    gold.sku && actual.sku ? normalizeText(gold.sku) === normalizeText(actual.sku) : normalizeText(gold.name) === normalizeText(actual.name);
  return sameIdentity && gold.qty === actual.qty && numbersMatch(gold.unitPrice, actual.unitPrice);
}

/** Exact multiset match: same count, each gold item paired with a distinct matching actual item. */
export function lineItemListsMatch(gold: readonly ExtractedLineItem[], actual: readonly ExtractedLineItem[]): boolean {
  if (gold.length !== actual.length) return false;
  const unused = [...actual];
  for (const item of gold) {
    const index = unused.findIndex((candidate) => lineItemsMatch(item, candidate));
    if (index === -1) return false;
    unused.splice(index, 1);
  }
  return true;
}

const NUMBER_FIELDS: ReadonlySet<ExtractedFieldName> = new Set<ExtractedFieldName>([
  "eventAmount",
  "returnWindowDays",
  "refundSlaDays",
  "priceAdjustDays",
]);

/**
 * Exact match of one extracted field against its gold value.
 * Strings: case/whitespace-insensitive. Numbers: within $0.01. `date`: same YYYY-MM-DD. `lineItems`: see
 * lineItemListsMatch. `totals`: every gold totals key within $0.01. `isStoreCredit`: missing counts as false.
 * A null gold value matches only a missing actual value.
 */
export function fieldMatches(field: ExtractedFieldName, gold: unknown, actual: unknown): boolean {
  if (field === "isStoreCredit") return (gold === true) === (actual === true);
  if (field === "lineItems") {
    return lineItemListsMatch((gold ?? []) as ExtractedLineItem[], (actual ?? []) as ExtractedLineItem[]);
  }
  if (field === "totals") {
    const goldTotals = (gold ?? {}) as Record<string, number | null | undefined>;
    const actualTotals = (actual ?? {}) as Record<string, number | null | undefined>;
    return Object.keys(goldTotals).every((key) => optionalNumbersMatch(goldTotals[key], actualTotals[key]));
  }
  if (isMissing(gold) || isMissing(actual)) return isMissing(gold) && isMissing(actual);
  if (NUMBER_FIELDS.has(field)) return typeof actual === "number" && numbersMatch(gold as number, actual);
  if (field === "date") {
    const goldDay = isoDay(String(gold));
    return goldDay !== null && goldDay === isoDay(String(actual));
  }
  return normalizeText(String(gold)) === normalizeText(String(actual));
}

export interface FieldScore {
  correct: number;
  total: number;
  accuracy: number;
}

export interface FieldMismatch {
  emailId: string;
  field: ExtractedFieldName;
  gold: unknown;
  actual: unknown;
}

export interface ExtractionFieldMetrics {
  emailsScored: number;
  /** Only fields present in at least one scored gold label appear. */
  perField: Partial<Record<ExtractedFieldName, FieldScore>>;
  /** Correct fields / scored fields across all emails (micro average). */
  overallAccuracy: number;
  mismatches: FieldMismatch[];
}

export interface ExtractionPair {
  emailId: string;
  gold: Partial<ExtractedFields>;
  actual: ExtractedFields;
}

export function extractionFieldMetrics(pairs: readonly ExtractionPair[]): ExtractionFieldMetrics {
  const perField: ExtractionFieldMetrics["perField"] = {};
  const mismatches: FieldMismatch[] = [];
  let correct = 0;
  let total = 0;
  for (const { emailId, gold, actual } of pairs) {
    for (const [name, goldValue] of Object.entries(gold)) {
      if (goldValue === undefined) continue;
      const field = name as ExtractedFieldName;
      const actualValue = actual[field];
      const score = (perField[field] ??= { correct: 0, total: 0, accuracy: 0 });
      score.total++;
      total++;
      if (fieldMatches(field, goldValue, actualValue)) {
        score.correct++;
        correct++;
      } else {
        mismatches.push({ emailId, field, gold: goldValue, actual: actualValue ?? null });
      }
    }
  }
  for (const score of Object.values(perField)) score.accuracy = ratio(score.correct, score.total);
  return { emailsScored: pairs.length, perField, overallAccuracy: ratio(correct, total), mismatches };
}

// ---------------------------------------------------------------------------------------------------------------
// Findings

/** A rules-engine finding resolved to the fields expected_findings.json is keyed on. */
export interface ComparableFinding {
  kind: FindingKind;
  merchant: string;
  orderRef: string | null;
  /** Line item name for item-level findings. */
  lineItem?: string | undefined;
  amountAtStake: number;
  /** YYYY-MM-DD of dueAt, null when not time-bound. */
  dueDate: string | null;
}

export interface FindingMetrics {
  expected: number;
  actual: number;
  truePositives: number;
  precision: number;
  recall: number;
  f1: number;
  /** Actual findings with no matching expected finding. */
  falsePositives: ComparableFinding[];
  /** Expected findings with no matching actual finding. */
  falseNegatives: ExpectedFinding[];
}

/**
 * Same finding: kind, merchant and orderRef equal (case/whitespace-insensitive), lineItem equal when the expected
 * finding names one, amount within $0.01, and dueDate equal when the expected finding has one.
 */
export function findingMatches(actual: ComparableFinding, expected: ExpectedFinding): boolean {
  if (actual.kind !== expected.kind) return false;
  if (normalizeText(actual.merchant) !== normalizeText(expected.merchant)) return false;
  if (actual.orderRef === null || normalizeText(actual.orderRef) !== normalizeText(expected.orderRef)) return false;
  if (expected.lineItem !== undefined) {
    if (actual.lineItem === undefined || normalizeText(actual.lineItem) !== normalizeText(expected.lineItem)) return false;
  }
  if (!numbersMatch(expected.amountAtStake, actual.amountAtStake)) return false;
  if (expected.dueDate !== undefined && actual.dueDate !== expected.dueDate) return false;
  return true;
}

/** Greedy one-to-one matching in expected order; each actual finding can satisfy at most one expected finding. */
export function findingMetrics(actual: readonly ComparableFinding[], expected: readonly ExpectedFinding[]): FindingMetrics {
  const unmatched = [...actual];
  const falseNegatives: ExpectedFinding[] = [];
  for (const want of expected) {
    const index = unmatched.findIndex((candidate) => findingMatches(candidate, want));
    if (index === -1) falseNegatives.push(want);
    else unmatched.splice(index, 1);
  }
  const truePositives = expected.length - falseNegatives.length;
  const precision = ratio(truePositives, actual.length);
  const recall = ratio(truePositives, expected.length);
  return {
    expected: expected.length,
    actual: actual.length,
    truePositives,
    precision,
    recall,
    f1: f1Of(precision, recall),
    falsePositives: unmatched,
    falseNegatives,
  };
}
