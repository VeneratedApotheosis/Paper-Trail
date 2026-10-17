import {
  ExtractionSchema,
  type ExtractedFieldName,
  type ExtractedFields,
  type Extraction,
  type GoldLabel,
  type RawEmail,
} from "@/lib/contracts";

/** EvidenceSchema caps quotes at 200 chars. */
const MAX_QUOTE_LENGTH = 200;
const FINAL_SALE_LINE = /final sale|non-returnable|cannot be returned/i;

/** Policy fields whose stated value is looked up as a sentence in the email text, with the keyword the line must have. */
const POLICY_LINE_KEYWORDS = {
  returnWindowDays: /return|devoluci/i,
  refundSlaDays: /refund|reembols/i,
  priceAdjustDays: /price adjust|ajuste/i,
} as const satisfies Partial<Record<ExtractedFieldName, RegExp>>;

type PolicyDaysField = keyof typeof POLICY_LINE_KEYWORDS;

function clipQuote(quote: string): string {
  return quote.length <= MAX_QUOTE_LENGTH ? quote : quote.slice(0, MAX_QUOTE_LENGTH);
}

function textLines(email: RawEmail): string[] {
  return email.text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function policyLineFor(lines: readonly string[], field: PolicyDaysField, days: number): string | null {
  const daysPattern = new RegExp(`\\b${days}\\s+(?:days|d[ií]as)\\b`, "i");
  return lines.find((line) => daysPattern.test(line) && POLICY_LINE_KEYWORDS[field].test(line)) ?? null;
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

/**
 * Builds an Extraction from a seed gold label so the pipeline can run on seed/inbox.json without an LLM.
 * Present fields get confidence 1 and model "gold". Gold labels carry no policy quote, so policy evidence (and
 * `policyQuote`, when the label has none) comes from the policy sentences in the email text: the line stating each
 * labeled policy field's day count, plus any final-sale line.
 */
export function extractionFromGoldLabel(email: RawEmail, goldLabel: GoldLabel): Extraction {
  const gold = goldLabel.fields;
  const evidence: Partial<Record<ExtractedFieldName, string>> = {};
  const policyLines: string[] = [];
  const isReceiptClass = goldLabel.class !== "marketing" && goldLabel.class !== "not_receipt";

  if (isReceiptClass) {
    const lines = textLines(email);
    for (const field of Object.keys(POLICY_LINE_KEYWORDS) as PolicyDaysField[]) {
      const days = gold[field];
      if (days == null) continue;
      const line = policyLineFor(lines, field, days);
      if (!line) continue;
      evidence[field] = clipQuote(line);
      if (!policyLines.includes(line)) policyLines.push(line);
    }
    for (const line of lines.filter((candidate) => FINAL_SALE_LINE.test(candidate))) {
      if (!policyLines.includes(line)) policyLines.push(line);
    }
  }

  const policyQuote = gold.policyQuote ?? (policyLines.length > 0 ? clipQuote(policyLines.join(" ")) : null);
  if (policyQuote) evidence.policyQuote = policyQuote;

  const fields: ExtractedFields = {
    ...gold,
    merchant: gold.merchant ?? null,
    orderRef: gold.orderRef ?? null,
    date: gold.date ?? null,
    currency: gold.currency ?? null,
    lineItems: gold.lineItems ?? [],
    totals: gold.totals ?? {},
    policyQuote,
  };

  const confidence: Partial<Record<ExtractedFieldName, number>> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (isPresent(value)) confidence[name as ExtractedFieldName] = 1;
  }

  return ExtractionSchema.parse({
    emailId: email.id,
    class: goldLabel.class,
    fields,
    confidence,
    evidence,
    confMin: 1,
    model: "gold",
    cached: false,
  });
}
