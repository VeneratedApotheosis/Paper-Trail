import type { Finding, NormalizedOrder } from "@/lib/contracts";
import { explainConfidence } from "@/components/findingExplain";

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
