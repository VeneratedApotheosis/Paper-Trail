import {
  ExpectedFindingsFileSchema,
  GoldLabelsFileSchema,
  SeedInboxSchema,
  type Classification,
  type EmailClass,
  type ExpectedFinding,
  type Extraction,
  type Finding,
  type GoldLabel,
  type NormalizedOrder,
  type RawEmail,
} from "@/lib/contracts";
import { SKIPPED_EXTRACTION_CLASSES, classify, prepareForLlm, redactionMode, type RedactionMode } from "@/lib/ingestion";
import { matchOrders, type MatchInput } from "@/lib/orders/matcher";
import { extractionFromGoldLabel } from "@/lib/pipeline/gold";
import { PriceFeedSchema } from "@/lib/prices/feed";
import { defaultRules, ruleVersionOf, runRules } from "@/lib/rules";
import expectedJson from "../../../seed/expected_findings.json";
import goldJson from "../../../seed/gold_labels.json";
import inboxJson from "../../../seed/inbox.json";
import priceFeedJson from "../../../seed/price-feed.json";
import {
  classificationMetrics,
  extractionFieldMetrics,
  findingMetrics,
  type ClassificationMetrics,
  type ComparableFinding,
  type ExtractionFieldMetrics,
  type FindingMetrics,
} from "./metrics";

/**
 * Eval harness over the synthetic seed (issue #21). Composes classify -> extraction -> matchOrders -> runRules at the
 * seed's fixed asOf and scores each stage against seed/gold_labels.json and seed/expected_findings.json.
 * No clock reads: the report timestamp comes from `opts.now`.
 */

export type EvalSplit = "all" | "holdout" | "dev";

/** Real extraction outputs (e.g. cached Claude results) keyed by the textHash of prepareForLlm(email), the same key the pipeline caches under (#125). */
export type ExtractionMap = Record<string, Extraction>;

export interface EvalOptions {
  /** "gold" (default) builds extractions from gold labels; a map supplies real model extractions by textHash. */
  extractionSource?: "gold" | ExtractionMap;
  /** Emails scored for extraction field accuracy and listed as misclassified. Classification always reports all splits. */
  split?: EvalSplit;
  /** Report timestamp, supplied by the caller. */
  now?: Date;
  /** Redaction mode the extraction map was recorded under (#125); default: PAPERTRAIL_REDACT, like the pipeline. */
  redaction?: RedactionMode;
}

export interface MisclassifiedEmail {
  emailId: string;
  holdout: boolean;
  gold: EmailClass;
  predicted: EmailClass;
  confidence: number;
  reason: string | null;
}

export interface ClassificationReport {
  source: string;
  splits: Record<EvalSplit, ClassificationMetrics>;
  safety: {
    /** Gold marketing or phishing look-alike emails the classifier routed to a receipt (extracted) class. Must be 0. */
    phishingOrMarketingAsOrder: number;
    phishingOrMarketingAsOrderEmails: string[];
    /** Any gold marketing/not_receipt email routed to a receipt class (includes account notices). */
    nonReceiptRoutedToExtraction: number;
    nonReceiptRoutedToExtractionEmails: string[];
  };
  /** Misclassified emails in `split`. */
  misclassified: MisclassifiedEmail[];
}

export type ExtractionReport =
  | { status: "not_run"; reason: string }
  | ({
      status: "ok";
      source: string;
      models: string[];
      split: EvalSplit;
      /** Gold receipt-class emails in the split with no entry in the extraction map (not scored). */
      emailsMissing: string[];
    } & ExtractionFieldMetrics);

export type FindingMode = "oracle-extraction" | "realistic-routing";

export interface FindingModeReport extends FindingMetrics {
  mode: FindingMode;
  label: string;
  extractionSource: string;
  /** Emails that received an extraction and entered the matcher. */
  emailsExtracted: number;
  /** Routed emails with no extraction available (only with an extraction map). */
  emailsMissingExtraction: string[];
  orders: number;
}

export interface EvalReport {
  synthetic: true;
  generatedAt: string | null;
  asOf: string;
  split: EvalSplit;
  sources: {
    dataset: string;
    classifier: string;
    extraction: string;
    rules: string[];
    priceFeed: string;
  };
  counts: {
    emails: number;
    dev: number;
    holdout: number;
    goldReceiptEmails: number;
    expectedFindings: number;
  };
  classification: ClassificationReport;
  extraction: ExtractionReport;
  findings: {
    /** Findings span several emails, so they are always computed on the full inbox regardless of `split`. */
    scope: "full inbox";
    oracleExtraction: FindingModeReport;
    realisticRouting: FindingModeReport;
  };
}

const CLASSIFIER_SOURCE = "rules-based classify() (deterministic, no LLM)";
const GOLD_EXTRACTION_SOURCE = "gold labels (oracle, not a model)";
const EXTRACTION_NOT_RUN_REASON = "no LLM extraction cache; run with a key";

const inbox = SeedInboxSchema.parse(inboxJson);
const goldLabels = GoldLabelsFileSchema.parse(goldJson).labels;
const expected = ExpectedFindingsFileSchema.parse(expectedJson);
const priceFeed = PriceFeedSchema.parse(priceFeedJson);

interface SeedEmail {
  email: RawEmail;
  label: GoldLabel;
  classification: Classification;
}

function isReceiptClass(cls: EmailClass): boolean {
  return !SKIPPED_EXTRACTION_CLASSES.has(cls);
}

function inSplit(label: GoldLabel, split: EvalSplit): boolean {
  if (split === "all") return true;
  return split === "holdout" ? label.holdout : !label.holdout;
}

function seedEmails(): SeedEmail[] {
  const labelsById = new Map(goldLabels.map((label) => [label.emailId, label]));
  return inbox.emails.map((email) => {
    const label = labelsById.get(email.id);
    if (!label) throw new Error(`No gold label for seed email ${email.id}`);
    return { email, label, classification: classify(email) };
  });
}

function classificationReport(emails: readonly SeedEmail[], split: EvalSplit): ClassificationReport {
  const metricsFor = (subset: EvalSplit) =>
    classificationMetrics(
      emails
        .filter(({ label }) => inSplit(label, subset))
        .map(({ label, classification }) => ({ gold: label.class, predicted: classification.class })),
    );

  const routedNonReceipts = emails.filter(
    ({ label, classification }) => !isReceiptClass(label.class) && isReceiptClass(classification.class),
  );
  const routedPhishingOrMarketing = routedNonReceipts.filter(
    ({ label }) => label.class === "marketing" || label.tags.includes("phishing_lookalike"),
  );

  return {
    source: CLASSIFIER_SOURCE,
    splits: { all: metricsFor("all"), dev: metricsFor("dev"), holdout: metricsFor("holdout") },
    safety: {
      phishingOrMarketingAsOrder: routedPhishingOrMarketing.length,
      phishingOrMarketingAsOrderEmails: routedPhishingOrMarketing.map(({ email }) => email.id),
      nonReceiptRoutedToExtraction: routedNonReceipts.length,
      nonReceiptRoutedToExtractionEmails: routedNonReceipts.map(({ email }) => email.id),
    },
    misclassified: emails
      .filter(({ label, classification }) => inSplit(label, split) && label.class !== classification.class)
      .map(({ email, label, classification }) => ({
        emailId: email.id,
        holdout: label.holdout,
        gold: label.class,
        predicted: classification.class,
        confidence: classification.confidence,
        reason: classification.reason ?? null,
      })),
  };
}

function extractionMapSource(map: ExtractionMap): { label: string; models: string[] } {
  const models = [...new Set(Object.values(map).map((extraction) => extraction.model))].sort();
  return { label: `extraction map (${models.join(", ") || "no models"})`, models };
}

function extractionReport(emails: readonly SeedEmail[], source: EvalOptions["extractionSource"], split: EvalSplit, redaction: RedactionMode): ExtractionReport {
  if (source === undefined || source === "gold") return { status: "not_run", reason: EXTRACTION_NOT_RUN_REASON };

  const scored = emails.filter(({ label }) => inSplit(label, split) && isReceiptClass(label.class));
  const pairs = [];
  const emailsMissing: string[] = [];
  for (const { email, label } of scored) {
    const extraction = source[prepareForLlm(email, redaction).textHash];
    if (extraction) pairs.push({ emailId: email.id, gold: label.fields, actual: extraction.fields });
    else emailsMissing.push(email.id);
  }
  const { label, models } = extractionMapSource(source);
  return { status: "ok", source: label, models, split, emailsMissing, ...extractionFieldMetrics(pairs) };
}

function comparableFindings(findings: readonly Finding[], orders: readonly NormalizedOrder[]): ComparableFinding[] {
  const orderById = new Map(orders.map((order) => [order.id, order]));
  return findings.map((finding) => {
    const order = orderById.get(finding.orderId);
    const item = order?.lineItems.find((candidate) => candidate.id === finding.lineItemId);
    return {
      kind: finding.kind,
      merchant: order?.merchant.name ?? "",
      orderRef: order?.orderRef ?? null,
      lineItem: item?.name,
      amountAtStake: finding.amountAtStake,
      dueDate: finding.dueAt?.slice(0, 10) ?? null,
    };
  });
}

function scoreFindings(
  mode: FindingMode,
  label: string,
  extractionSource: string,
  inputs: readonly MatchInput[],
  emailsMissingExtraction: string[],
  expectedFindings: readonly ExpectedFinding[],
): FindingModeReport {
  const orders = matchOrders(inputs);
  const findings = runRules(orders, defaultRules, { now: new Date(inbox.asOf), priceFeed });
  return {
    mode,
    label,
    extractionSource,
    emailsExtracted: inputs.length,
    emailsMissingExtraction,
    orders: orders.length,
    ...findingMetrics(comparableFindings(findings, orders), expectedFindings),
  };
}

/** Sanity mode: every gold receipt-class email gets its gold extraction (should score 1.0 / 1.0). */
function oracleFindings(emails: readonly SeedEmail[]): FindingModeReport {
  const inputs = emails
    .filter(({ label }) => isReceiptClass(label.class))
    .map(({ email, label }) => ({ email, extraction: extractionFromGoldLabel(email, label) }));
  return scoreFindings(
    "oracle-extraction",
    "Oracle extraction: gold extractions for every gold receipt email -> matcher -> rules (pipeline sanity check)",
    GOLD_EXTRACTION_SOURCE,
    inputs,
    [],
    expected.findings,
  );
}

/**
 * Realistic mode: only emails classify() routes to a receipt class get an extraction, carrying the predicted class
 * (as extract() does), so classifier misses and misroutes propagate into finding precision/recall.
 */
function realisticFindings(emails: readonly SeedEmail[], source: EvalOptions["extractionSource"], redaction: RedactionMode): FindingModeReport {
  const map = source === undefined || source === "gold" ? null : source;
  const inputs: MatchInput[] = [];
  const missing: string[] = [];
  for (const { email, label, classification } of emails) {
    if (!isReceiptClass(classification.class)) continue;
    const base = map ? map[prepareForLlm(email, redaction).textHash] : extractionFromGoldLabel(email, label);
    if (!base) {
      missing.push(email.id);
      continue;
    }
    inputs.push({ email, extraction: { ...base, emailId: email.id, class: classification.class } });
  }
  return scoreFindings(
    "realistic-routing",
    "Realistic routing: classify() gates extraction; predicted classes flow into matcher -> rules",
    map ? extractionMapSource(map).label : GOLD_EXTRACTION_SOURCE,
    inputs,
    missing,
    expected.findings,
  );
}

/** Runs the full eval over the committed synthetic seed. */
export function runEval(opts: EvalOptions = {}): EvalReport {
  const split = opts.split ?? "all";
  const redaction = opts.redaction ?? redactionMode();
  const emails = seedEmails();
  const extractionSourceLabel =
    opts.extractionSource === undefined || opts.extractionSource === "gold"
      ? GOLD_EXTRACTION_SOURCE
      : extractionMapSource(opts.extractionSource).label;

  return {
    synthetic: true,
    generatedAt: opts.now ? opts.now.toISOString() : null,
    asOf: inbox.asOf,
    split,
    sources: {
      dataset: "seed/ (synthetic inbox, gold labels, expected findings)",
      classifier: CLASSIFIER_SOURCE,
      extraction: extractionSourceLabel,
      rules: defaultRules.map(ruleVersionOf),
      priceFeed: priceFeed.simulated ? "seed/price-feed.json (simulated)" : "seed/price-feed.json",
    },
    counts: {
      emails: emails.length,
      dev: emails.filter(({ label }) => !label.holdout).length,
      holdout: emails.filter(({ label }) => label.holdout).length,
      goldReceiptEmails: emails.filter(({ label }) => isReceiptClass(label.class)).length,
      expectedFindings: expected.findings.length,
    },
    classification: classificationReport(emails, split),
    extraction: extractionReport(emails, opts.extractionSource, split, redaction),
    findings: {
      scope: "full inbox",
      oracleExtraction: oracleFindings(emails),
      realisticRouting: realisticFindings(emails, opts.extractionSource, redaction),
    },
  };
}
