import { formatDate, formatMoney } from "@/lib/format";

// Plain-language rows for the "Why?" panel, built from a finding's `explain`
// payload (rule inputs, see src/lib/rules). Known keys get a plain label and a
// readable value; keys that only repeat what the card already shows are hidden;
// unknown keys fall back to a humanized label so nothing is silently dropped.

export interface ExplainRow {
  label: string;
  value: string;
}

// Shown elsewhere on the card (headline, summary, quote, confidence tip).
const HIDDEN_KEYS = new Set(["rule", "summary", "sourceQuote", "confidence"]);

// Single dates the rules also list (with labels) in `dates`: hidden when `dates` is present.
const DATE_KEYS = new Set(["triggerAt", "expectedBy", "anchorAt", "deadline", "adjustBy", "observedAt"]);

const LABELS: Record<string, string> = {
  triggerType: "How we know the return arrived",
  triggerAt: "Refund clock started",
  slaDays: "Days the store has to refund",
  refundSlaDays: "Days the store has to refund",
  slaSource: "Where that time limit came from",
  policySource: "Where that time limit came from",
  expectedBy: "Refund was due by",
  expectedAmount: "Refund we expected",
  expectedRefund: "Refund we expected",
  refundedAmount: "Refund you got",
  actualRefund: "Refund you got",
  tolerance: "Small differences we ignore",
  checkPolicy: "Worth checking",
  anchorType: "Return window counts from",
  windowAnchor: "Return window counts from",
  anchorAt: "Counting from",
  windowDays: "Return window (days)",
  returnWindowDays: "Return window (days)",
  windowSource: "Where that window came from",
  deadline: "Window closes",
  daysLeft: "Days left",
  paidUnitPrice: "You paid (each)",
  currentPrice: "Price now",
  qty: "Quantity you kept",
  drop: "Price drop",
  threshold: "Smallest drop we flag",
  priceAdjustDays: "Price adjustment window (days)",
  adjustBy: "Claim by",
  priceSource: "Where the new price came from",
  observedAt: "New price seen on",
};

const MONEY_KEYS = new Set([
  "expectedAmount",
  "expectedRefund",
  "refundedAmount",
  "actualRefund",
  "tolerance",
  "paidUnitPrice",
  "currentPrice",
  "drop",
  "threshold",
]);

const VALUE_WORDS: Record<string, string> = {
  email_text: "The receipt email",
  default: "A standard time limit (not in your emails)",
  user: "Set by you",
  strong: "The store confirmed it got the return",
  weak: "Return started or dropped off, not confirmed received",
  delivery: "Delivery date",
  order: "Order date",
  mock: "Simulated price feed",
  email_promo: "A price in a promo email",
};

// Turn a key like "refundSlaDays" into "Refund sla days".
function humanizeKey(key: string): string {
  const spaced = key.replace(/([A-Z])/g, " $1").replace(/[_-]+/g, " ").trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function renderValue(key: string, value: unknown, currency: string): string {
  if (typeof value === "number") return MONEY_KEYS.has(key) ? formatMoney(value, currency) : String(value);
  if (key === "checkPolicy") return "We are not sure of this window. Compare it with the quote.";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDate(value);
    return VALUE_WORDS[value] ?? value;
  }
  return JSON.stringify(value);
}

function isDatePair(value: unknown): value is { label: string; value: string } {
  if (typeof value !== "object" || value === null) return false;
  const pair = value as Record<string, unknown>;
  return typeof pair.label === "string" && typeof pair.value === "string";
}

export function explainRows(explain: Record<string, unknown>, currency: string): ExplainRow[] {
  const dates = Array.isArray(explain.dates) ? explain.dates.filter(isDatePair) : [];
  const rows: ExplainRow[] = dates.map((pair) => ({
    label: pair.label,
    value: renderValue("date", pair.value, currency),
  }));
  for (const [key, value] of Object.entries(explain)) {
    if (HIDDEN_KEYS.has(key) || key === "dates") continue;
    if (dates.length > 0 && DATE_KEYS.has(key)) continue;
    rows.push({ label: LABELS[key] ?? humanizeKey(key), value: renderValue(key, value, currency) });
  }
  return rows;
}

// The rules store the lowest extraction confidence (0..1) in explain.confidence.
export function explainConfidence(explain: Record<string, unknown>): number | null {
  const value = explain.confidence;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
