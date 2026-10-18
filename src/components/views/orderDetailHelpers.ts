import type { Finding, NormalizedOrder } from "@/lib/contracts";
import { explainConfidence } from "@/components/findingExplain";
import type { OrderSource } from "@/components/sourceAccounts";
import { confidenceLabel } from "@/lib/format";

// How sure we are we read this order correctly (0..1): the lowest confidence any finding recorded, otherwise the
// order's own lowest extraction confidence. It is about reading the email, never the chance of getting paid.
export function orderConfidence(order: Pick<NormalizedOrder, "confMin">, findings: readonly Pick<Finding, "explain">[]): number {
  const fromFindings = findings
    .map((finding) => explainConfidence(finding.explain))
    .filter((value): value is number => value !== null);
  const lowest = fromFindings.length > 0 ? Math.min(...fromFindings) : order.confMin;
  return Math.min(1, Math.max(0, lowest));
}

// "2 emails" / "1 email" for the Source card. Counts the emails the order was read from.
export function emailCountLabel(count: number): string {
  return `${count} ${count === 1 ? "email" : "emails"}`;
}

// The Source card sentence: how many emails the order was read from, and which mailbox when it is known (demo and
// uploaded purchases have none).
export function sourceCardText(count: number, sources: readonly Pick<OrderSource, "label">[]): string {
  const from = sources.length > 0 ? ` from ${sources.map((source) => source.label).join(" and ")}` : "";
  return `Read from ${emailCountLabel(count)}${from}. Nothing is stored beyond these quotes.`;
}

// Width of the confidence bar, as a whole percent clamped to 0..100.
export function confidenceBarPercent(confidence: number): number {
  return Math.round(Math.min(1, Math.max(0, confidence)) * 100);
}

// "How sure are we" level word, shared with the chips.
export const confidenceWord = confidenceLabel;

// The primary action on a finding in the order detail. Open findings start a draft, drafted ones reopen the claim,
// and closed ones (resolved, dismissed) offer nothing here.
export function claimActionLabel(status: Finding["status"]): string | null {
  if (status === "open") return "Draft a claim";
  if (status === "drafted") return "Open your claim";
  return null;
}
